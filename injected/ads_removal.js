var currentTracks = [];
var removedAdsList = [];
var deviceId = "";

var originalFetch = window.fetch;

var isSimulatingStateChnage = false;

//
// Hook the fetch() function
//
window.fetch = function(url, init)
{
    if (url != undefined && url.includes("/state"))
    {
        return originalFetch.call(window, url, init).then(function(response)
        {
            var modifiedResponse = onFetchResponseReceived(url, init, response);
            return modifiedResponse;
        });
    }
    else if (url != undefined && url.endsWith("/devices"))
    {
        var request = JSON.parse(init.body);
        deviceId = request.device.device_id;
    }

    // make the original request
    var fetchResult = originalFetch.call(window, url, init);
    return fetchResult;
};

//
// Hook the WebSocket channel
//
wsHook.after = function(messageEvent, url) 
{
    var data = JSON.parse(messageEvent.data);
    if (data.payloads == undefined) return messageEvent;

    var payload = data.payloads[0];
    if (payload.type == "replace_state")
    {
        var stateMachine = payload["state_machine"];
        var stateRef = payload["state_ref"];
        if (stateRef != null) 
        {
            var currentStateIndex = stateRef["state_index"];

            payload["state_machine"] = manipulateStateMachine(stateMachine, currentStateIndex, true);
            data.payloads[0] = payload;
        }

        if (isSimulatingStateChnage) 
        {
            // block this notification from reching the client, to prevent song chnage
            return new MessageEvent(messageEvent.type, {data: "{}"});
        }
    }
    else if (payload.cluster != undefined)
    {
        deviceId = payload.cluster.active_device_id;
        if (payload.update_reason == "DEVICE_STATE_CHANGED")
        {
            // TODO: cluster.player_state.next_tracks ?
        }
    }

    messageEvent.data = JSON.stringify(data);
    return messageEvent;
}

function onFetchResponseReceived(url, init, responseBody)
{
    var requestBody = init.body;
    var request = JSON.parse(requestBody);

    var originalJsonPromise = responseBody.json();
    responseBody.json = function()
    {
        return originalJsonPromise.then(function(data)
        {
            var stateMachine = data["state_machine"];           
            var updatedStateRef = data["updated_state_ref"];    
            if (stateMachine == undefined || updatedStateRef == null) return data;

            var currentStateIndex = updatedStateRef["state_index"];

            data["state_machine"] = manipulateStateMachine(stateMachine, currentStateIndex, false);

            return data;

        }).catch(function(reason)
        {
            console.error(reason);
        });
    };
    
    return responseBody;
}

function manipulateStateMachine(stateMachine, startingStateIndex, isReplacingState)
{
    var states = stateMachine["states"];
    var tracks = stateMachine["tracks"];

    var stateMachineString = "";

    do
    {
        var removedAds = false;
        stateMachineString = "";

        for (var i = 0; i < states.length; i++)
        {
            var state = states[i];

            var trackID = state["track"];
            var track = tracks[trackID];
            var trackURI = track["metadata"]["uri"];
            var trackName = track["metadata"]["name"];

            stateMachineString += trackName + " => ";

            if (trackURI.includes(":ad:") && state["disallow_seeking"] == true)
            {   
                if (i == startingStateIndex && !isReplacingState) 
                {
                    console.log("SpotifyExtension: Could not remove ad at " + trackURI + " because it is currently playing");
                    debugger;
                    showToast("Couldn't remove ad...");
                    continue;
                }

                var nextState = findNextTrackState(states, tracks, startingStateIndex, track);
                if (nextState != null) 
                {
                    // make this state equal to the next one 
                    state = nextState;

                    onAdRemoved(trackURI);

                    removedAds = true;
                }
                else
                {
                    // we can't really skip over this state becuase we don't know where to skip to.
                    // Either we will be able to do so in the next states update, or we won't.
                    // In case we won't let's at least shorten the ad.
                    console.log("SpotifyExtension: Shortned ad at " + trackURI);

                    state["disallow_seeking"] = false;
                    state["restrictions"] = {};
                    state["initial_playback_position"] = 1000000;
                }

                // replace the current state
                states[i] = state;

                break;
            }
        }

    }
    while (removedAds);

    stateMachine["states"] = states;
    stateMachine["tracks"] = tracks;

    currentTracks = tracks;

    return stateMachine;
}

function onAdRemoved(trackURI)
{
    console.log("SpotifyAdBlocker: Removed ad at " + trackURI);
    if (!removedAdsList.includes(trackURI))
    {
        removedAdsList.push(trackURI);
        showToast("Removed ad");
    }
}

function showToast(text)
{
    var snackbar = document.getElementById("snackbar");
    snackbar.innerText = text;
    snackbar.className = "show";

    setTimeout(function(){ snackbar.className = snackbar.className.replace("show", ""); }, 3000);
}

function* statesGenerator(states, startingStateIndex = 2, nextStateName = "skip_next")
{
    var currentState = states[startingStateIndex];
    var iterationCount = 0;

    for (var state = currentState; state != undefined; state = states[state["transitions"][nextStateName]["state_index"]])
    {
        iterationCount++;

        yield state;

        var nextTransition = state["transitions"][nextStateName];
        if (nextTransition == undefined) break;
    }

    return iterationCount;
}

function findNextTrackState(states, tracks, startingStateIndex = 2, sourceTrack)
{
    var foundTrack = false;
    for (var state of statesGenerator(states, startingStateIndex, "advance"))
    {
        var trackID = state["track"];
        var track = tracks[trackID];
        if (foundTrack)
            return state;

        if (track["metadata"]["uri"] == sourceTrack["metadata"]["uri"])
        {
            // same track
            foundTrack = true;
        }
        else
            foundTrack = false;

    }

    return null;
}

//
// Graphics
//

startObserving();

function startObserving()
{
    var mutationObserver = new MutationObserver(function (mutations)
    {
        for (var i = 0; i < mutations.length; i++)
        {
            var addedNodes = mutations[i].addedNodes;
            var removedNodes = mutations[i].removedNodes;

            for (var j = 0; j < addedNodes.length; j++)
            {
                var addedNode = addedNodes[j];
                if (addedNode.getAttribute == undefined) continue;
    
                if (addedNode.getAttribute("role") == "row")
                {
                    // song row added
                }

                if (addedNode.classList.contains("os-resize-observer"))
                {
                    var snackbar = document.createElement('div');
                    snackbar.setAttribute("id", "snackbar");
                    addedNode.appendChild(snackbar);
                }
            }
        }
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
}