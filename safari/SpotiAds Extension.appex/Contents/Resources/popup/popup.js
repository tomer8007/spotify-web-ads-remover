chrome.browserAction.getBadgeText({}, function(result)
{
    if (result != "" && result != undefined)
    {
        document.getElementById("text").innerText = "So far, " + result + " audio ads were removed successfully in Spotify's queue.";
    }
});