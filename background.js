// this is the background page!
chrome.runtime.onMessage.addListener(onMessage);

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

chrome.webRequest.onHeadersReceived.addListener(function(details)
{
    for (var i = 0; i < details.responseHeaders.length; ++i) 
    {
        if (details.responseHeaders[i].name.toLowerCase() == "content-security-policy")
        {
            var cspValue = details.responseHeaders[i].value;
            var entries = cspValue.split(";");
            for (var j = 0; j < entries.length; j++)
            {
                if (entries[j].includes("script-src"))
                {
                    // a hack to allow the page to load our injected inline scripts
                    entries[j] += " 'unsafe-inline'"; 
                }
            }

            details.responseHeaders[i].value = entries.join(";");
            
        }
    }

    return {responseHeaders: details.responseHeaders};

}, {urls: ["<all_urls>"]}, ["blocking", "responseHeaders"]);