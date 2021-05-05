// this is the background page!

if (typeof chrome !== "undefined") {
  var browser = chrome;
}

browser.runtime.onMessage.addListener(onMessage);

function onMessage(messageEvent, sender, callback)
{
    if (messageEvent.name == "updateCounter")
    {
        if ("counterValue" in messageEvent) {
			chrome.browserAction.setBadgeText({text: messageEvent.counterValue.toString()});
		}
    }
    else if (messageEvent.name == "getCounter")
    {
        chrome.browserAction.getBadgeText({}, function(result)
        {
            callback(result);
        });
        
    }
}
