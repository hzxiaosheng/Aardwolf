'use strict';

/*
 * Server for communication between the UI and the mobile library.
 * Also serves UI-related files.
 */

var http = require('http');
var path = require('path');
var fs = require('fs');
var URL = require('url');
var config = require('../config/config.defaults.js');
var util = require('./server-util.js');

function run() {
    /* Server for web service ports and debugger UI */
    http.createServer(AardwolfServer).listen(config.serverPort, null, function() {
        console.log('Server listening for requests on port ' + config.serverPort + '.');
    });
}

var defaultMobileDispatcher = new Dispatcher();
var defaultDesktopDispatcher = new Dispatcher();
var dispatcherMap = {};
function getClientIp(req) {
    return req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket.remoteAddress;
};

function getClientUA(req){
    var ua = req.headers['user-agent'];
    return ua;
}
    
function AardwolfServer(req, res) {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    var body = '';
    if (req.method == 'OPTIONS') {
        res.end();
        return;
    }
    else if (req.method == 'POST') {
        req.on('data', function (chunk) { body += chunk; });
        req.on('end', function () { processPostedData(JSON.parse(body)); });
    }
    else {
        processPostedData();
    }

    function processPostedData(data) {
        var mobileDispatcher, desktopDispatcher, targetId;
        var reqInfo = URL.parse(req.url, true);
        if(reqInfo.query && reqInfo.query.targetId && dispatcherMap[reqInfo.query.targetId]){
            targetId = reqInfo.query.targetId;
            if(reqInfo.pathname.indexOf('/desktop/') > -1 || reqInfo.pathname.indexOf('/ui/') > -1){
                console.log('> desktop: ' + targetId);
                console.log('pathname: ' + reqInfo.pathname);
            }
            mobileDispatcher = dispatcherMap[targetId].mobileDispatcher;
            desktopDispatcher = dispatcherMap[targetId].desktopDispatcher;
        }else if(reqInfo.pathname.indexOf('/mobile/') > -1){
            var clientIp, clientUa;
             clientIp = getClientIp(req);
            clientUa = getClientUA(req);
            targetId = clientIp + '-' + clientUa.replace(/\s/g, '-');
            console.log('> mobile : ' + targetId);
            console.log('pathname: ' + reqInfo.pathname);
            if(!dispatcherMap[targetId] /*|| (Date.now() - dispatcherMap[targetId].lastAccessTime >= 1000 * 60 * 10)*/){
                dispatcherMap[targetId] = {};
                dispatcherMap[targetId].mobileDispatcher = new Dispatcher();
                dispatcherMap[targetId].desktopDispatcher = new Dispatcher();
            }
            dispatcherMap[targetId].lastAccessTime = Date.now();
            mobileDispatcher = dispatcherMap[targetId].mobileDispatcher;
            desktopDispatcher = dispatcherMap[targetId].desktopDispatcher;
        }else{
            mobileDispatcher = defaultMobileDispatcher;
            desktopDispatcher = defaultDesktopDispatcher;
        }
        switch (reqInfo.pathname) {
            case '/mobile/init':
                mobileDispatcher.end();
                mobileDispatcher = dispatcherMap[targetId].mobileDispatcher = new Dispatcher();
                mobileDispatcher.setClient(res);
                desktopDispatcher.clearMessages();
                desktopDispatcher.addMessage(data);
                break;

            case '/mobile/console':
                desktopDispatcher.addMessage(data);
                ok200();
                break;

            case '/mobile/breakpoint':
                desktopDispatcher.addMessage(data);
                mobileDispatcher.setClient(res);
                break;

            case '/mobile/incoming':
                mobileDispatcher.setClient(res);
                break;

            case '/desktop/outgoing':
                mobileDispatcher.addMessage(data);
                ok200();
                break;

            case '/desktop/incoming':
                desktopDispatcher.setClient(res);
                break;

            case '/files/list':
                ok200({ files: util.getFilesList() });
                break;

            case '/':
            case '/ui':
            case '/ui/':
                var targetIds = Object.keys(dispatcherMap);
                //if(targetIds.length == 0){
                //    res.writeHead(302, {'Location': '/ui/index.html'});
                //    res.end();
                //}else{
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    var htmls = [
                        '<!DOCTYPE html>',
                        '<html>',
                            '<head>',
                                '<title>targetIds</title>',
                                '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />',
                            '</head>',
                            '<body>',
                                '<h1>' + targetIds.length + ' remote targets connected with aardwolf server: </h1>',
                                '<ol>',
                                    targetIds.map(function(targetId){
                                        return '<li><a href="/ui/index.html?targetId='+ targetId + '" target="_blank">' + targetId + '</a></li>' 
                                    }).join('\n'),
                                '</ol>',
                            '</body>',
                        '</html>'
                        ];
                    res.end(htmls.join('\n'));
                //}
                
                break;

            default:
                /* check if we need to serve a UI file */
                if (reqInfo.pathname.indexOf('/ui/') === 0) {
                    var requestedFile = reqInfo.pathname.substr(4);
                    var uiFilesDir = path.join(__dirname, '../ui/');
                    var fullRequestedFilePath = path.join(uiFilesDir, requestedFile);

                    /* File must exist and must be located inside the uiFilesDir */
                    if (fs.existsSync(fullRequestedFilePath) && fullRequestedFilePath.indexOf(uiFilesDir) === 0) {
                        util.serveStaticFile(res, fullRequestedFilePath);
                        break;
                    }
                }

                /* check if we need to serve a UI file */
                if (reqInfo.pathname.indexOf('/files/data/') === 0) {
                    var requestedFile = reqInfo.pathname.substr(12);
                    var filesDir = path.normalize(config.fileServerBaseDir);
                    var fullRequestedFilePath = path.join(filesDir, requestedFile);

                    /* File must exist and must be located inside the filesDir */
                    if (fs.existsSync(fullRequestedFilePath) && fullRequestedFilePath.indexOf(filesDir) === 0) {
                        ok200({
                            data: fs.readFileSync(fullRequestedFilePath).toString(),
                            breakpoints: require('../rewriter/multirewriter.js').getRewrittenContent(requestedFile).breakpoints || []
                        });
                        break;
                    }
                }

                /* fallback... */
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end('NOT FOUND');
        }
    }

    function ok200(data) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data || {}));
    }
}


function Dispatcher() {
    var queue = [];
    var client;

    this.setClient = function(c) {
        this.end();
        client = c;
        process();
    };

    this.addMessage = function(m) {
        queue.push(m);
        process();
    };

    this.end = function() {
        if (client) {
            client.end();
        }
    };

    this.clearMessages = function() {
        queue = [];
    };

    function process() {
        if (client && queue.length > 0) {
            client.writeHead(200, { 'Content-Type': 'application/json' });
            var msg = queue.shift();
            client.end(JSON.stringify(msg));
            client = null;
        }
    }
}

module.exports.run = run;
