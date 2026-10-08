/**
 * Salesforce LWS/Locker often injects CommonJS `module`/`exports` into loadScript
 * scope. The @microsoft/signalr browser UMD then takes the Node path and fails with
 * "require is not defined". Force global attachment + shadow those identifiers.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
    __dirname,
    '..',
    'force-app',
    'main',
    'default',
    'staticresources',
    'signalr.js'
);

let c = fs.readFileSync(target, 'utf8');

// Unwrap prior patch if re-run.
const wrapStart = '(function(){\n  var module, exports, define;\n';
if (c.startsWith(wrapStart)) {
    c = c.slice(wrapStart.length);
    const wrapEnd =
        '\n  if (typeof window !== "undefined" && !window.signalR && typeof self !== "undefined" && self.signalR) {\n' +
        '    window.signalR = self.signalR;\n' +
        '  }\n' +
        '})();\n';
    if (c.endsWith(wrapEnd)) {
        c = c.slice(0, -wrapEnd.length);
    }
}

const umdFooter =
    '"object"==typeof exports&&"object"==typeof module?module.exports=e():"function"==typeof define&&define.amd?define([],e):"object"==typeof exports?exports.signalR=e():t.signalR=e();';
const forcedFooter = 't.signalR=e();';

if (c.includes(umdFooter)) {
    c = c.replace(umdFooter, forcedFooter);
} else if (!c.includes(forcedFooter)) {
    console.error('Could not find UMD footer to patch');
    process.exit(1);
}

const wrapped =
    wrapStart +
    c.trim() +
    '\n  if (typeof window !== "undefined" && !window.signalR && typeof self !== "undefined" && self.signalR) {\n' +
    '    window.signalR = self.signalR;\n' +
    '  }\n' +
    '})();\n';

fs.writeFileSync(target, wrapped);
console.log('Patched', target, 'length', wrapped.length);
