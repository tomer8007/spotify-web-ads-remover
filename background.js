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
			browser.browserAction.setBadgeText({text: messageEvent.counterValue.toString()});
		}
    }
    else if (messageEvent.name == "getCounter")
    {
        browser.browserAction.getBadgeText({}, function(result)
        {
            callback(result);
        });
        
    }
}

browser.webRequest.onHeadersReceived.addListener(function(details)
{
    for (var i = 0; i < details.responseHeaders.length; ++i) 
    {
        if (details.responseHeaders[i].name.toLowerCase() == "content-security-policy")
        {
            // a hack to allow the page to load our injected inline scripts
            details.responseHeaders[i].value += " script-src 'self' 'unsafe-inline'";
        }
    }

    return {responseHeaders: details.responseHeaders};

}, {urls: ["<all_urls>"]}, ["blocking", "responseHeaders"]);
