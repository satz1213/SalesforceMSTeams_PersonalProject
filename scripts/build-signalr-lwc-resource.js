/**
 * Build force-app/.../staticresources/signalrLwc.js from the existing
 * browser SignalR bundle, LWS-hardened.
 *
 * LWS often hides free globals (AbortController, fetch, WebSocket) and is unreliable
 * with bare `self` inside loadScript-evaluated code (live: referencing self after load
 * rejected loadScript with bare undefined; loadScript also hung >20s while Network
 * showed ~5ms download — pointing at script execution, not the fetch).
 *
 * v4: shadow `var self = global` so the webpack bundle never touches LWS's real self.
 */
const fs = require('fs');
const path = require('path');

const srcPath = path.join(
    __dirname,
    '..',
    'force-app',
    'main',
    'default',
    'staticresources',
    'signalr.js'
);
const outJs = path.join(
    __dirname,
    '..',
    'force-app',
    'main',
    'default',
    'staticresources',
    'signalrLwc.js'
);
const outMeta = path.join(
    __dirname,
    '..',
    'force-app',
    'main',
    'default',
    'staticresources',
    'signalrLwc.resource-meta.xml'
);

let body = fs.readFileSync(srcPath, 'utf8');

body = body
    .replace(/^\(function\(\)\{\s*var module, exports, define;\s*/m, '')
    .replace(
        /\n\s*if \(typeof window !== "undefined" && !window\.signalR[\s\S]*\}\)\(\);\s*$/m,
        ''
    )
    .replace(/\n\/\/# sourceMappingURL=.*$/m, '')
    .replace(/^\/\* signalrLwc:[\s\S]*?\*\/\s*/m, '');

const umdFooter =
    '"object"==typeof exports&&"object"==typeof module?module.exports=e():"function"==typeof define&&define.amd?define([],e):"object"==typeof exports?exports.signalR=e():t.signalR=e();';
const forcedFooter = 't.signalR=e();';
if (body.includes(umdFooter)) {
    body = body.replace(umdFooter, forcedFooter);
} else if (!body.includes(forcedFooter)) {
    console.error('Unexpected SignalR footer; aborting');
    process.exit(1);
}

const coreIdx = body.indexOf('var t,e;t=self,e=()=>');
if (coreIdx < 0) {
    // Already rewritten in a previous peel — accept t=global form from a half-built file
    const alt = body.indexOf('var t,e;t=');
    if (alt < 0) {
        console.error('SignalR core marker not found');
        process.exit(1);
    }
}
if (coreIdx >= 0) {
    body = body.slice(coreIdx).trim();
} else {
    body = body.slice(body.indexOf('var t,e;t=')).trim();
}

const endMarker = 't.signalR=e();';
const endIdx = body.lastIndexOf(endMarker);
if (endIdx >= 0) {
    body = body.slice(0, endIdx + endMarker.length);
}

// Force UMD root onto our shadowed self/global, not LWS's real self identifier.
body = body.replace(/^var t,e;t=self,/, 'var t,e;t=self,');

const prelude = `/* signalrLwc: @microsoft/signalr 8.0.7 browser, LWS-hardened v4 */
(function (global) {
  var module;
  var exports;
  var define;
  // CRITICAL for LWS + loadScript: do not touch the real free \`self\` binding.
  // Shadow it with the sandbox global we were passed (globalThis/window).
  var self = global;

  function installAbortPolyfill() {
    function AbortSignalPolyfill() {
      this.aborted = false;
      this.reason = undefined;
      this.onabort = null;
      this._listeners = [];
    }
    AbortSignalPolyfill.prototype.addEventListener = function (type, listener) {
      if (type === 'abort' && typeof listener === 'function') {
        this._listeners.push(listener);
      }
    };
    AbortSignalPolyfill.prototype.removeEventListener = function (type, listener) {
      if (type !== 'abort') {
        return;
      }
      this._listeners = this._listeners.filter(function (l) {
        return l !== listener;
      });
    };
    AbortSignalPolyfill.prototype.dispatchEvent = function (event) {
      if (!event || event.type !== 'abort') {
        return false;
      }
      var me = this;
      if (typeof this.onabort === 'function') {
        this.onabort.call(this, event);
      }
      this._listeners.slice().forEach(function (l) {
        l.call(me, event);
      });
      return true;
    };
    AbortSignalPolyfill.prototype.throwIfAborted = function () {
      if (this.aborted) {
        throw this.reason || new Error('Aborted');
      }
    };

    function AbortControllerPolyfill() {
      this.signal = new AbortSignalPolyfill();
    }
    AbortControllerPolyfill.prototype.abort = function (reason) {
      if (this.signal.aborted) {
        return;
      }
      this.signal.aborted = true;
      this.signal.reason = reason !== undefined ? reason : new Error('Aborted');
      this.signal.dispatchEvent({ type: 'abort' });
    };

    return {
      AbortController: AbortControllerPolyfill,
      AbortSignal: AbortSignalPolyfill
    };
  }

  var AbortController = global.AbortController;
  var AbortSignal = global.AbortSignal;
  var usingAbortPolyfill = false;
  if (typeof AbortController !== 'function') {
    var poly = installAbortPolyfill();
    AbortController = poly.AbortController;
    AbortSignal = poly.AbortSignal;
    usingAbortPolyfill = true;
    global.AbortController = AbortController;
    global.AbortSignal = AbortSignal;
  }

  var nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
  var fetch = nativeFetch;
  if (nativeFetch && usingAbortPolyfill) {
    fetch = function (input, init) {
      init = init || {};
      var signal = init.signal;
      if (!signal || typeof signal.aborted !== 'boolean') {
        return nativeFetch(input, init);
      }
      var next = {};
      for (var k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k) && k !== 'signal') {
          next[k] = init[k];
        }
      }
      return new Promise(function (resolve, reject) {
        if (signal.aborted) {
          reject(signal.reason || new Error('Aborted'));
          return;
        }
        var onAbort = function () {
          reject(signal.reason || new Error('Aborted'));
        };
        signal.addEventListener('abort', onAbort);
        nativeFetch(input, next).then(
          function (res) {
            signal.removeEventListener('abort', onAbort);
            resolve(res);
          },
          function (err) {
            signal.removeEventListener('abort', onAbort);
            reject(err);
          }
        );
      });
    };
    global.fetch = fetch;
  }

  var WebSocket = global.WebSocket;
  var EventSource = global.EventSource;

  function require(id) {
    if (id === 'abort-controller') {
      return AbortController;
    }
    throw new Error('signalrLwc: blocked require(' + id + ')');
  }
`;

const epilogue = `
  var api = t.signalR;
  if (!api || !api.HubConnectionBuilder) {
    throw new Error('signalrLwc: factory did not produce signalR');
  }
  global.signalR = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;

const wrapped = prelude + body + epilogue;

fs.writeFileSync(outJs, wrapped);
fs.writeFileSync(
    outMeta,
    `<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Public</cacheControl>
    <contentType>application/javascript</contentType>
    <description>@microsoft/signalr 8.0.7 browser, LWS-hardened v4 (shadow self=globalThis). Public cache.</description>
</StaticResource>
`
);

console.log('Wrote', outJs, 'len', wrapped.length);
console.log('v4 marker:', wrapped.includes('LWS-hardened v4'));
console.log('shadow self:', wrapped.includes('var self = global'));
