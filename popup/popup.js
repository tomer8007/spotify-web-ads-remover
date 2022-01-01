chrome.browserAction.getBadgeText({}, function(result)
{
    if (result != "" && result != undefined)
    {
        document.getElementById("text").innerHTML = "So far, <b>" + result + "</b> audio ads were removed from Spotify's queue.";
    }
});