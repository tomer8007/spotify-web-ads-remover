#!/usr/bin/env node
'use strict';

// Regression test for V-001: proves that loading injected/ads_removal.js
// (as it is actually injected by content_script.js — a classic, non-module
// <script src>, sharing the page's `window` with injected/utils.js loaded
// just before it) does NOT leak accessToken, clientToken, authorizationHeader,
// deviceId, or internal helper functions as enumerable `window.*` properties,
// while `window.fetch` DOES end up overridden (that override is intentional).
//
// Run: node test/verify-no-global-credentials.js  (exit 0 = pass, 1 = fail)

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..');
const UTILS_SRC = fs.readFileSync(path.join(REPO_ROOT, 'injected', 'utils.js'), 'utf8');
const ADS_REMOVAL_SRC = fs.readFileSync(path.join(REPO_ROOT, 'injected', 'ads_removal.js'), 'utf8');

// Identifiers that must NEVER be reachable via `window.<name>` after this
// file loads. (accessToken/clientToken/authorizationHeader/deviceId are the
// credential/session state from V-001; the functions are included so a
// future accidental removal of the IIFE wrap is caught immediately too.)
const MUST_NOT_LEAK = [
    'accessToken',
    'clientToken',
    'authorizationHeader',
    'deviceId',
    'getStates',
    'manipulateStateMachine',
    'onAccessTokenResponseIntercepted',
];

function buildSandbox() {
    const sandbox = {};
    // `window === globalThis` in a real page: top-level `var` in a classic
    // script attaches to the global object, which IS `window`. Self-reference
    // so the test actually exercises the same leak surface as the browser.
    sandbox.window = sandbox;
    sandbox.document = {
        documentElement: {},
        dispatchEvent: function () {},
    };
    sandbox.CustomEvent = function CustomEvent(type, opts) {
        this.type = type;
        this.detail = opts && opts.detail;
    };
    sandbox.MutationObserver = function MutationObserver(_cb) {
        this.observe = function () {};
    };
    sandbox.setTimeout = function (_fn, _ms) { return 0; }; // never actually fire timers/mutation callbacks
    // wsHook is a real pre-existing global created by injected/ws_hook.js
    // (loaded before ads_removal.js). That file is out of scope for V-001;
    // stub the object shape only so `wsHook.after = ...` doesn't throw.
    sandbox.wsHook = {};
    vm.createContext(sandbox);
    return sandbox;
}

function loadScripts(sandbox) {
    // Run as two separate scripts against the same context, mirroring
    // content_script.js injecting utils.js and ads_removal.js as two
    // separate <script src> tags into the same page/window.
    vm.runInContext(UTILS_SRC, sandbox, { filename: 'injected/utils.js' });
    vm.runInContext(ADS_REMOVAL_SRC, sandbox, { filename: 'injected/ads_removal.js' });
}

function assertNoLeaks(sandbox, label) {
    const leaked = MUST_NOT_LEAK.filter((name) =>
        Object.prototype.hasOwnProperty.call(sandbox, name)
    );
    assert.deepStrictEqual(
        leaked,
        [],
        `[${label}] Found credential/internal identifiers leaked onto window: ${leaked.join(', ')}`
    );
    assert.strictEqual(
        typeof sandbox.fetch,
        'function',
        `[${label}] window.fetch should exist (it is intentionally overridden)`
    );
}

function testLoadOnly() {
    const sandbox = buildSandbox();
    loadScripts(sandbox);
    assertNoLeaks(sandbox, 'load-only');
    console.log('PASS: no credential/internal globals leak at load time.');
}

function testAfterSimulatedStateFetch() {
    const sandbox = buildSandbox();

    // Stub the ORIGINAL window.fetch (captured as `originalFetch` at the top
    // of ads_removal.js, before it gets overwritten by the interceptor).
    sandbox.fetch = function stubOriginalFetch(_url, _init) {
        return Promise.resolve({
            status: 200,
            // Empty body: no state_machine/updated_state_ref/commands means
            // onStatesFetchResponseReceived's inner handler short-circuits
            // without needing real state-machine/Swal/structuredClone stubs.
            json: async function () { return {}; },
        });
    };

    loadScripts(sandbox); // window.fetch is now the ads_removal.js override

    return Promise.resolve()
        .then(() => {
            const fakeInit = {
                headers: {
                    authorization: 'Bearer TEST_ACCESS_TOKEN',
                    'client-token': 'TEST_CLIENT_TOKEN',
                },
                body: JSON.stringify({ state_ref: { state_id: 'abc123' } }),
            };
            return sandbox.fetch(
                'https://spclient.wg.spotify.com/track-playback/v1/devices/dev1/state',
                fakeInit
            );
        })
        .then((result) => {
            assert.strictEqual(
                typeof result.json,
                'function',
                'fetch override should resolve to a response-like object'
            );
            assertNoLeaks(sandbox, 'after-simulated-/state-fetch');
            console.log(
                'PASS: authorizationHeader/clientToken captured without leaking to window after a simulated /state request.'
            );
        });
}

async function main() {
    testLoadOnly();
    await testAfterSimulatedStateFetch();
    console.log('All checks passed.');
}

main().catch((err) => {
    console.error('FAIL:', err.message || err);
    process.exit(1);
});
