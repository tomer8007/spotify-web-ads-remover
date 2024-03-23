var currentTracks = [];
var removedAdsList = [];
var tamperedStatesIds = [];
var deviceId = "";

var totalAdsRemoved = 0;

var originalFetch = window.fetch;
var isFetchInterceptionWorking = false;
var isWebScoketInterceptionWorking = false;
var isSimulatingStateChnage = false;
var didShowMultiDeviceWarning = false;
var didShowInterceptionWarning = false;
var didCheckForInterception = false;


var accessToken = "";

startObserving();
refreshAccessToken();

document.dispatchEvent(new CustomEvent('updateCounter', {detail: 0}));

async function refreshAccessToken()
{
    console.log("SpotiAds: Refreshing access token.");

    var getTokenUrl = "https://open.spotify.com/get_access_token?reason=transport&productType=web_player";

    // get access token
    var result = await fetch(getTokenUrl, {credentials: "same-origin"});
    var resultJson = await result.json();
    accessToken = resultJson["accessToken"];
}

//
// Hook the fetch() function.
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

    // Make the original request.
    var fetchResult = originalFetch.call(window, url, init);
    return fetchResult;
};

//
// Hook the WebSocket channel.
//
wsHook.after = function(messageEvent, url) 
{
    return new Promise(async function(resolve, reject)
    {
        var data = JSON.parse(messageEvent.data);
        if (data.payloads == undefined) {resolve(messageEvent); return;}

        for (var i= 0; i < data.payloads.length; i++)
        {
            var payload = data.payloads[i];
            if (payload.type == "replace_state")
            {
                var stateMachine = payload["state_machine"];
                var stateRef = payload["state_ref"];
                if (stateRef != null) 
                {
                    var currentStateIndex = stateRef["state_index"];
    
                    payload["state_machine"] = await manipulateStateMachine(stateMachine, currentStateIndex, true);
                    data.payloads[i] = payload;
    
                    isWebScoketInterceptionWorking = true;
                }
    
                if (isSimulatingStateChnage) 
                {
                    // Block this notification from reaching the client, to prevent song change.
                    return new MessageEvent(messageEvent.type, {data: "{}"});
                }
            }
            else if (payload.cluster != undefined)
            {
                if (payload.update_reason == "DEVICE_STATE_CHANGED")
                {
                    if (deviceId != payload.cluster.active_device_id)
                    {
                        // TODO: Find a way to really detect when another device is playing
                        // instead of having false positives

                        // showMultiDeviceWarning();
                    }
                }
            }
        }

        messageEvent.data = JSON.stringify(data);

        resolve(messageEvent);
    });
}

function onFetchResponseReceived(url, init, responseBody)
{
    var requestBody = init.body;
    var request = JSON.parse(requestBody);

    var originalJsonPromise = responseBody.json();
    responseBody.json = function()
    {
        return originalJsonPromise.then(async function(data)
        {
            var stateMachine = data["state_machine"];           
            var updatedStateRef = data["updated_state_ref"];    
            if (stateMachine == undefined || updatedStateRef == null) return data;

            var currentStateIndex = updatedStateRef["state_index"];

            data["state_machine"] = await manipulateStateMachine(stateMachine, currentStateIndex, false);

            isFetchInterceptionWorking = true;

            return data;

        }).catch(function(reason)
        {
            console.error(reason);
        });
    };
    
    return responseBody;
}

async function manipulateStateMachine(stateMachine, startingStateIndex, isReplacingState)
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
            var stateId = states[i]["state_id"];
            
            var trackID = state["track"];
            var track = tracks[trackID];

            var trackURI = track["metadata"]["uri"];
            var trackName = track["metadata"]["name"];

            stateMachineString += trackName + " => ";

            if (isAd(state, stateMachine))
            {   
                console.log("SpotifyAdRemover: Encountered ad in " + trackURI);

                var nextState = getNextState(stateMachine, track, i);
                if (isAd(nextState, stateMachine))
                {
                    // We can't really skip over this state because we don't know where to skip to.
                    // We will request even more states, or, if this fails, at least shorten the ad.
                    
                    try
                    {
                        var maxAttempts = 3;
                        var j = 0;
                        var futureStateMachine = stateMachine;
                        do
                        {
                            var latestTrack = futureStateMachine["tracks"][nextState["track"]];
                            futureStateMachine = await getStates(futureStateMachine["state_machine_id"], nextState["state_id"]);
                            nextState = getNextState(futureStateMachine, latestTrack);

                            j++;
                        }
                        while (isAd(nextState, futureStateMachine) && j < maxAttempts)
                        
                        if (isAd(nextState, futureStateMachine))
                        {
                            // print out debugging information
                            console.error("could not find the next ad-free state. state machine was:");
                            console.error(futureStateMachine);
                            debugger;
                        }

                        var nextStateId = nextState["state_id"];

                        // Fix the new state to be suitable for replacing in the currenet state machine.
                        nextState["state_id"] = stateId;
                        nextState["transitions"] = {};
                        nextTrack = futureStateMachine["tracks"][nextState["track"]];
                        tracks.push(nextTrack);
                        nextState["track"] = tracks.length - 1;
                            
                        if (i == startingStateIndex && !isReplacingState) 
                        {
                            // Our new state is going to be played now, let's point the player at the future state machine.
                            nextState["state_id"] = nextStateId;
                            stateMachine["state_machine_id"] = futureStateMachine["state_machine_id"];

                            console.log("SpotifyAdRemover: Removed ad at " + trackURI + ", more complex flow");
                        }

                    }
                    catch (exception)
                    {
                        state = shortenedState(state, track);
                        console.log("SpotifyAdRemover: Shortned ad at " + trackURI + " due to exception:");
                        console.error(exception);
                        console.error(exception.stack);
                    }

                    removedAds = true;
                }

                if (nextState != null) 
                {
                    // Make this state equal to the next one.
                    state = nextState;
                    tamperedStatesIds.push(nextState["state_id"]);

                    removedAds = true;
                }

                // Replace the current state.
                states[i] = state;
            }

            if (i == startingStateIndex && !isReplacingState && tamperedStatesIds.includes(stateId)) 
            {
                // Our new ad-free state is going to be played now.
                console.log("SpotifyAdRemover: Removed ad at " + trackURI);
                onAdRemoved(trackURI);
            }

        }

    }
    while (removedAds);

    stateMachine["states"] = states;
    stateMachine["tracks"] = tracks;

    currentTracks = tracks;

    return stateMachine;
}

function shortenedState(state, track)
{
    var trackDuration = track["metadata"]["duration"];

    state["disallow_seeking"] = false;
    state["restrictions"] = {};
    state["initial_playback_position"] = trackDuration;
    state["position_offset"] = trackDuration;

    return state;
}

async function getStates(stateMachineId, startingStateId, maxRetries = 3)
{
    var statesUrl = "https://spclient.wg.spotify.com/track-playback/v1/devices/" + deviceId + "/state";
    var body = {"seq_num":1619015341662,"state_ref":{"state_machine_id":stateMachineId, "state_id": startingStateId,"paused":false},
            "sub_state":{"playback_speed":1,"position":0,"duration":0,"stream_time":0,"media_type":"AUDIO","bitrate":160000},"previous_position":0
            ,"debug_source":"resume"};

    var result = await originalFetch.call(window, statesUrl,{method: 'PUT', headers: {'Authorization': "Bearer " + accessToken, 'Content-Type': 'application/json'}, 
                                                            body: JSON.stringify(body)});
    if (result.status != 200)
    {
        var resultText = await result.text();

        // Assume the access token has expired without checking it too much.
        // var resultJson = await result.json();
        // var looksExpired = (resultJson["error"] && resultJson["error"]["message"] == "The access token expired")

        // Refresh the access token and try again.
        await refreshAccessToken();
        result = await originalFetch.call(window, statesUrl,{method: 'PUT', headers: {'Authorization': "Bearer " + accessToken, 'Content-Type': 'application/json'}, 
                                                            body: JSON.stringify(body)});
    }

    // TODO: There is a case where the request will return a 502 Error code.
    // This will return a null stateMachine, and just shorten the ad instead of removing it.
    // Retry for now
    
    var resultJson = await result.json();
    var stateMachine = resultJson["state_machine"];
    if (!stateMachine)
    {
        debugger;
        if (maxRetries > 0)
            return getStates(stateMachineId, startingStateId, --maxRetries)
    }

    return stateMachine;
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

function getNextState(stateMachine, sourceTrack, startingStateIndex = 2, excludeAds = true)
{
    var states = stateMachine["states"];
    var tracks = stateMachine["tracks"];
    var previousState = null;

    var foundTrack = false;
    for (var state of statesGenerator(states, startingStateIndex, "advance"))
    {
        var trackID = state["track"];
        var track = tracks[trackID];
        
        if (foundTrack) 
        {
            if (excludeAds && track["content_type"] == "AD") continue;
            return state;
        }

        if (previousState == state)
        {
            console.error("Cyclic state machine detected.");
            debugger;
            return state;
        }

        foundTrack = (track["metadata"]["uri"] == sourceTrack["metadata"]["uri"]);
        previousState = state;

    }

    return state;
}

function getPreviousState(stateMachine, sourceTrack, startingStateIndex = 2)
{
    var states = stateMachine["states"];
    var tracks = stateMachine["tracks"];
    
    var foundTrack = false;
    for (var state of statesGenerator(states, startingStateIndex, "advance"))
    {
        if (state["transitions"]["advance"] == null) return null;
        
        var nextState = states[state["transitions"]["advance"]["state_index"]];
        var nextStateTrack = tracks[nextState["track"]];

        if (nextStateTrack["metadata"]["uri"] == sourceTrack["metadata"]["uri"])
        {
            return state;
        }

    }

    return null;
}

function isAd(state, stateMachine)
{
    var states = stateMachine["states"];
    var tracks = stateMachine["tracks"];

    var trackID = state["track"];
    var track = tracks[trackID];

    var trackURI = track["metadata"]["uri"];

    return trackURI.includes(":ad:");
}

//
// Graphics
//

function onMainUIReady(addedNode)
{
    var snackbar = document.createElement('div');
    snackbar.setAttribute("id", "snackbar");
    addedNode.appendChild(snackbar);
}

function onAdRemoved(trackURI, skipped = false)
{
    if (!removedAdsList.includes(trackURI))
    {
        removedAdsList.push(trackURI);
        if (skipped)
            showToast("Skipped ad");
        else
            showToast("Removed ad");

        totalAdsRemoved++;

        document.dispatchEvent(new CustomEvent('updateCounter', {detail: totalAdsRemoved}));
    }
}

var lastMissedAdTime = 0;

function onAdCouldntBeRemoved(trackURI)
{
    console.log("SpotifyAdRemover: Could not remove ad at " + trackURI + " because it is currently playing");

    var now = new Date();

    if (now - lastMissedAdTime > 60000)
    {
        Swal.fire({
            title: "Can't remove ad",
            html: "It appears that an ad was missed and couldn't be removed. Please report that back to the developer.",
            icon: "warning",
            width: 600,
            confirmButtonColor: "#DD6B55",
            confirmButtonText: "Got it",
            heightAuto: false
        });
    }

    lastMissedAdTime = now;
}

function showToast(text)
{
    var snackbar = document.getElementById("snackbar");
    snackbar.innerText = text;
    snackbar.className = "show";

    setTimeout(function(){ snackbar.className = snackbar.className.replace("show", ""); }, 3000);
}

function onSongResumed()
{
    setTimeout(checkInterception, 1000);
}

function checkInterception()
{
    var isInterceptionWorking = isFetchInterceptionWorking && isWebScoketInterceptionWorking;
    if (isInterceptionWorking)
    {
        if (!didCheckForInterception) 
            console.log("SpotifyAdRemover: Interception is working.");
        didCheckForInterception = true;
    }
    else if (!didShowInterceptionWarning && !didShowMultiDeviceWarning)
    {
        Swal.fire({
            title: "Oops...",
            html: "Spotify Ads Remover has detected that interception is not fully working. Please try refreshing this page, or, if the problem presists, writing back to the developer.",
            icon: "error",
            width: 600,
            confirmButtonColor: "#DD6B55",
            confirmButtonText: "OK",
            heightAuto: false
        });

        didShowInterceptionWarning = true;
    }
}

function showMultiDeviceWarning()
{
    if (!didShowMultiDeviceWarning)
    {
        Swal.fire({
            title: "Another device is playing",
            html: "Please note that Spotify Ads Remover can't control over other playing devices, so ads will not be removed unless audio will play from this tab.",
            icon: "warning",
            width: 500,
            confirmButtonColor: "#DD6B55",
            confirmButtonText: "OK",
            heightAuto: false
        });

        didShowMultiDeviceWarning = true;
    }
}

function startObserving()
{
    var mutationObserver = new MutationObserver(function (mutationList)
    {
        mutationList.forEach( (mutation) => {
            switch(mutation.type) {
              case 'childList':
                /* One or more children have been added to and/or removed
                   from the tree. */
                   var addedNodes = mutation.addedNodes;
       
                   for (var j = 0; j < addedNodes.length; j++)
                   {
                       var addedNode = addedNodes[j];
                       if (addedNode.getAttribute == undefined) continue;
           
                       if (addedNode.getAttribute("role") == "row")
                       {
                           // Song row added.
                       }
       
                       if (addedNode.id && addedNode.id.includes("main"))
                       {
                           onMainUIReady(addedNode);
                       }
                   }
                   
                break;
              case 'attributes':
                /* An attribute value changed on the element in
                   mutation.target. */
                   var changedNode = mutation.target;
                   if (changedNode.getAttribute("aria-label") == "Pause")
                   {
                        onSongResumed();
                   }
                   
                break;
            }
          });
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributeFilter: ["aria-label"] });

    setTimeout(function()
    {
        if (document.getElementById("main"))
        {
            var mainElement = document.getElementById("main");
            onMainUIReady(mainElement);
        }

    }, 2000);
}
