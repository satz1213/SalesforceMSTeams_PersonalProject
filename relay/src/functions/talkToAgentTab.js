/**
 * Serves the static web page behind the "Talk to an Agent" Teams personal tab
 * (teamsapp-talk-to-agent/manifest.json). A Teams tab is just an iframe pointing at a hosted
 * page, so this function's only job is to BE that page - no business logic, no auth, no shared
 * state with any other relay function (see the plan's "Feature boundaries" section for why that
 * separation matters: this must not become a second path into the Case Swarm / MessagingSession
 * chat features already built).
 *
 * Renders a fully custom chat UI against Salesforce's "Custom Client" REST API for Messaging
 * In-App and Web (the org's "MIAW_Custom_Client" deployment, DeploymentType=API, on the same
 * "Live Chat" MessagingChannel used elsewhere) instead of loading Salesforce's own
 * bootstrap.min.js widget UI. All calls (access token, create conversation, send message, SSE
 * for incoming messages) go straight from this page's own JS to Salesforce's public scrt2
 * domain - no relay function, no Apex, no shared code path with Case Swarm or the
 * MessagingSession -> Teams chat pipeline. A MessagingSession created this way still flows
 * through the existing accept -> Teams chat -> live chat window pipeline unchanged once an
 * agent accepts it in Omni-Channel, same as any other channel entry point.
 */
const { app } = require('@azure/functions');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Talk to an Agent</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #FAFAFA;
    color: #242424;
  }
  .screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
  }
  .screen.hidden {
    display: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    max-width: 320px;
    width: 100%;
  }
  .icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: linear-gradient(135deg, #0070D2, #00B5D8);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 26px;
    flex: none;
  }
  .card h1 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0;
  }
  .card p {
    font-size: 0.9rem;
    color: #616161;
    margin: 0;
    line-height: 1.4;
  }
  .field {
    width: 100%;
    text-align: left;
  }
  .field label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    color: #424242;
    margin-bottom: 4px;
  }
  .field input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid #D8D9DB;
    border-radius: 8px;
    font-size: 0.9rem;
    font-family: inherit;
  }
  .field input:focus {
    outline: none;
    border-color: #0070D2;
  }
  .talk-btn {
    margin-top: 6px;
    padding: 12px 28px;
    border: none;
    border-radius: 999px;
    background: #0070D2;
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
    width: 100%;
  }
  .talk-btn:hover:not(:disabled) {
    background: #005FB2;
  }
  .talk-btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .talk-btn:disabled {
    background: #C9C9C9;
    cursor: default;
  }
  .status {
    font-size: 0.8rem;
    color: #8A8A8A;
    min-height: 1em;
  }
  .status.error {
    color: #C0392B;
  }

  /* Full chat screen - Claude/ChatGPT-style: header, scrolling message list, fixed composer. */
  .chat-screen {
    padding: 0;
    justify-content: flex-start;
  }
  .chat-header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid #E5E5E5;
    font-weight: 600;
  }
  .end-chat-btn {
    flex: none;
    padding: 6px 14px;
    border: 1px solid #D8D9DB;
    border-radius: 999px;
    background: #fff;
    color: #C0392B;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .end-chat-btn:hover {
    background: #FBEEEC;
  }
  .end-chat-btn:disabled {
    color: #B5B5B5;
    cursor: default;
    background: #fff;
  }
  .chat-header .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2ECC71;
  }
  .chat-messages {
    flex: 1;
    width: 100%;
    overflow-y: auto;
    padding: 16px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 0.9rem;
    line-height: 1.4;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
  .bubble.me {
    align-self: flex-end;
    background: #0070D2;
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .bubble.agent {
    align-self: flex-start;
    background: #F0F1F2;
    color: #242424;
    border-bottom-left-radius: 4px;
  }
  .bubble.system {
    align-self: center;
    background: transparent;
    color: #8A8A8A;
    font-size: 0.78rem;
    max-width: 100%;
    text-align: center;
  }
  .chat-composer {
    flex: none;
    display: flex;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid #E5E5E5;
    box-sizing: border-box;
  }
  .chat-composer input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #D8D9DB;
    border-radius: 999px;
    font-size: 0.9rem;
    font-family: inherit;
  }
  .chat-composer input:focus {
    outline: none;
    border-color: #0070D2;
  }
  .chat-composer button {
    padding: 10px 20px;
    border: none;
    border-radius: 999px;
    background: #0070D2;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .chat-composer button:disabled {
    background: #C9C9C9;
    cursor: default;
  }
</style>
</head>
<body>

  <!-- Landing screen -->
  <div class="screen" id="landingScreen">
    <div class="card">
      <div class="icon">&#128172;</div>
      <h1>Talk to an Agent</h1>
      <p>Start a live chat with our support team, right here in Teams.</p>
      <button id="landingBtn" class="talk-btn">Talk to an Agent</button>
    </div>
  </div>

  <!-- Pre-chat screen (our own form - replaces Salesforce's default pre-chat UI) -->
  <div class="screen hidden" id="prechatScreen">
    <div class="card">
      <div class="icon">&#128172;</div>
      <h1>A few details first</h1>
      <p>So an agent knows who they're chatting with.</p>
      <div class="field">
        <label for="pcFirst">First name</label>
        <input id="pcFirst" type="text" autocomplete="given-name" />
      </div>
      <div class="field">
        <label for="pcLast">Last name</label>
        <input id="pcLast" type="text" autocomplete="family-name" />
      </div>
      <div class="field">
        <label for="pcEmail">Email</label>
        <input id="pcEmail" type="email" autocomplete="email" />
      </div>
      <button id="pcSubmit" class="talk-btn">Start Conversation</button>
      <div class="status" id="pcStatus"></div>
    </div>
  </div>

  <!-- Chat screen -->
  <div class="screen chat-screen hidden" id="chatScreen">
    <div class="chat-header">
      <span class="dot"></span>
      <span style="flex:1">Live Chat</span>
      <button id="endChatBtn" class="end-chat-btn">End Chat</button>
    </div>
    <div class="chat-messages" id="chatMessages"></div>
    <form class="chat-composer" id="chatComposer">
      <input id="chatInput" type="text" placeholder="Type a message..." autocomplete="off" disabled />
      <button id="chatSendBtn" type="submit" disabled>Send</button>
    </form>
  </div>

  <!-- Required for any content rendered inside a Microsoft Teams tab iframe - Teams shows a
       stuck loading state until the app signals it has initialized. Unrelated to identity/SSO;
       every tab needs this regardless. -->
  <script src="https://res.cdn.office.net/teams-js/2.19.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>
  <script>
    if (window.microsoftTeams) {
      microsoftTeams.app.initialize().then(function () {
        microsoftTeams.app.notifySuccess();
      }).catch(function () {
        // Not fatal - this page still works if ever opened outside Teams (e.g. directly in a
        // browser while testing).
      });
    }
  </script>

  <script>
  (function () {
    // Same org/deployment identifiers the standard Web snippet uses elsewhere in this project,
    // but pointed at the API-type "Custom Client" deployment instead of the Web one, so this
    // page can drive its own UI instead of loading Salesforce's widget.
    var ORG_ID = '00D2v000001e1KA';
    var ES_DEVELOPER_NAME = 'MIAW_Custom_Client';
    var SCRT2_URL = 'https://mylightningapp-dev-dev-ed.my.salesforce-scrt.com';

    var landingScreen = document.getElementById('landingScreen');
    var prechatScreen = document.getElementById('prechatScreen');
    var chatScreen = document.getElementById('chatScreen');
    var pcStatus = document.getElementById('pcStatus');
    var chatMessages = document.getElementById('chatMessages');
    var chatInput = document.getElementById('chatInput');
    var chatSendBtn = document.getElementById('chatSendBtn');

    var accessToken = null;
    var conversationId = null;
    var lastEventId = null;
    var knownAgents = {};
    var conversationEnded = false;

    // Resume an in-progress conversation across tab reloads instead of always starting a new
    // one - each POST /conversation creates a real MessagingSession, so reloading the tab a few
    // times mid-chat would otherwise leave several abandoned sessions behind. Wrapped in
    // try/catch since localStorage can throw (private browsing, blocked site data).
    var SESSION_STORAGE_KEY = 'talkToAgentSession';

    function saveSession() {
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
          accessToken: accessToken,
          conversationId: conversationId,
          lastEventId: lastEventId
        }));
      } catch (e) {
        console.warn('Could not save session to localStorage:', e);
      }
    }

    function loadSession() {
      try {
        var raw = localStorage.getItem(SESSION_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('Could not read session from localStorage:', e);
        return null;
      }
    }

    function clearSession() {
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch (e) {
        // Not fatal - worst case a stale entry is overwritten by the next saveSession().
      }
    }

    function showScreen(el) {
      [landingScreen, prechatScreen, chatScreen].forEach(function (s) {
        s.classList.toggle('hidden', s !== el);
      });
    }

    function uuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    function appendBubble(kind, text) {
      var el = document.createElement('div');
      el.className = 'bubble ' + kind;
      el.textContent = text;
      chatMessages.appendChild(el);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return el;
    }

    document.getElementById('landingBtn').addEventListener('click', function () {
      showScreen(prechatScreen);
    });

    document.getElementById('pcSubmit').addEventListener('click', function () {
      var firstName = document.getElementById('pcFirst').value.trim();
      var lastName = document.getElementById('pcLast').value.trim();
      var email = document.getElementById('pcEmail').value.trim();
      if (!firstName || !email) {
        pcStatus.textContent = 'First name and email are required.';
        pcStatus.classList.add('error');
        return;
      }
      pcStatus.classList.remove('error');
      pcStatus.textContent = 'Connecting...';
      startConversation(firstName, lastName, email);
    });

    function startConversation(firstName, lastName, email) {
      fetch(SCRT2_URL + '/iamessage/api/v2/authorization/unauthenticated/access-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: ORG_ID,
          esDeveloperName: ES_DEVELOPER_NAME,
          capabilitiesVersion: '1',
          platform: 'Web'
        })
      })
        .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
        .then(function (result) {
          console.log('access-token response:', result.body);
          if (!result.ok || !result.body || !result.body.accessToken) {
            throw new Error('No access token in response');
          }
          accessToken = result.body.accessToken;
          lastEventId = result.body.lastEventId || null;
          conversationId = uuid();

          return fetch(SCRT2_URL + '/iamessage/api/v2/conversation', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + accessToken
            },
            body: JSON.stringify({
              conversationId: conversationId,
              esDeveloperName: ES_DEVELOPER_NAME,
              language: 'en_US',
              routingAttributes: {
                firstName: firstName,
                lastName: lastName,
                email: email
              }
            })
          });
        })
        .then(function (res) {
          return res.text().then(function (text) {
            console.log('create-conversation status:', res.status, 'body:', text);
            if (!res.ok) throw new Error('Failed to create conversation (status ' + res.status + ')');
          });
        })
        .then(function () {
          saveSession();
          showScreen(chatScreen);
          appendBubble('system', 'Conversation started. An agent will join shortly.');
          chatInput.disabled = false;
          chatSendBtn.disabled = false;
          chatInput.focus();
          connectEventStream();
        })
        .catch(function (err) {
          console.error('Failed to start conversation:', err);
          pcStatus.classList.add('error');
          pcStatus.textContent = 'Could not connect right now. Please try again.';
        });
    }

    document.getElementById('chatComposer').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = chatInput.value.trim();
      if (!text || !accessToken || !conversationId) return;
      chatInput.value = '';
      appendBubble('me', text);

      fetch(SCRT2_URL + '/iamessage/api/v2/conversation/' + conversationId + '/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + accessToken
        },
        body: JSON.stringify({
          message: {
            id: uuid(),
            messageType: 'StaticContentMessage',
            staticContent: {
              formatType: 'Text',
              text: text
            }
          },
          esDeveloperName: ES_DEVELOPER_NAME,
          isNewMessagingSession: false
        })
      })
        .then(function (res) {
          return res.text().then(function (body) {
            console.log('send-message status:', res.status, 'body:', body);
          });
        })
        .catch(function (err) {
          console.error('Failed to send message:', err);
        });
    });

    // Real-time incoming messages via Server-Sent Events. Uses fetch + a manual stream reader
    // rather than the native EventSource API, because EventSource cannot send a custom
    // Authorization header and this endpoint requires the bearer token from the access-token
    // call above.
    var sseRetryCount = 0;
    var SSE_MAX_RETRIES = 8; // give up instead of retrying forever - a sustained retry loop
                              // against this endpoint is exactly what can trigger a platform-
                              // side rate-limit/throttle on Salesforce's messaging gateway,
                              // which affects more than just this tab.
    var SSE_BASE_DELAY_MS = 2000;
    var SSE_MAX_DELAY_MS = 60000;

    function connectEventStream() {
      if (conversationEnded) return;
      fetch(SCRT2_URL + '/eventrouter/v1/sse', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          Accept: 'text/event-stream',
          'X-Org-Id': ORG_ID
        }
      })
        .then(function (res) {
          if (!res.ok || !res.body) throw new Error('SSE connect failed (status ' + res.status + ')');
          sseRetryCount = 0; // reset backoff once a connection actually succeeds
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';

          function pump() {
            if (conversationEnded) {
              reader.cancel().catch(function () {});
              return;
            }
            return reader.read().then(function (result) {
              if (result.done) {
                if (conversationEnded) return;
                scheduleSseRetry('SSE stream closed');
                return;
              }
              buffer += decoder.decode(result.value, { stream: true });
              var parts = buffer.split('\\n\\n');
              buffer = parts.pop();
              parts.forEach(handleSseFrame);
              return pump();
            });
          }
          return pump();
        })
        .catch(function (err) {
          if (conversationEnded) return;
          scheduleSseRetry('SSE connection error: ' + err);
        });
    }

    function scheduleSseRetry(reason) {
      sseRetryCount++;
      if (sseRetryCount > SSE_MAX_RETRIES) {
        console.error(reason + ' - giving up after ' + SSE_MAX_RETRIES + ' attempts.');
        appendBubble('system', 'Lost connection to the chat. Please reopen this tab to reconnect.');
        return;
      }
      var delay = Math.min(SSE_BASE_DELAY_MS * Math.pow(2, sseRetryCount - 1), SSE_MAX_DELAY_MS);
      console.log(reason + ', retrying in ' + delay + 'ms (attempt ' + sseRetryCount + '/' + SSE_MAX_RETRIES + ')');
      setTimeout(connectEventStream, delay);
    }

    function endConversation() {
      if (!accessToken || !conversationId || conversationEnded) return;
      var endChatBtn = document.getElementById('endChatBtn');
      endChatBtn.disabled = true;
      endChatBtn.textContent = 'Ending...';

      fetch(SCRT2_URL + '/iamessage/api/v2/conversation/' + conversationId + '?esDeveloperName=' + encodeURIComponent(ES_DEVELOPER_NAME), {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'X-Org-Id': ORG_ID
        }
      })
        .then(function (res) {
          return res.text().then(function (body) {
            console.log('close-conversation status:', res.status, 'body:', body);
          });
        })
        .catch(function (err) {
          console.error('Failed to close conversation:', err);
        })
        .then(function () {
          conversationEnded = true;
          clearSession();
          appendBubble('system', 'You ended the conversation.');
          chatInput.disabled = true;
          chatSendBtn.disabled = true;
          endChatBtn.textContent = 'Chat ended';
        });
    }

    document.getElementById('endChatBtn').addEventListener('click', function () {
      if (window.confirm('End this chat?')) {
        endConversation();
      }
    });

    function handleSseFrame(frame) {
      var eventType = null;
      var dataLines = [];
      frame.split('\\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) eventType = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
        else if (line.indexOf('id:') === 0) lastEventId = line.slice(3).trim();
      });
      if (!dataLines.length) return;
      var raw = dataLines.join('\\n');
      console.log('SSE event:', eventType, raw);
      var payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        return;
      }

      var entry = payload && payload.conversationEntry;
      var sender = entry && entry.sender;
      var entryPayload = entry && entry.entryPayload ? JSON.parse(entry.entryPayload) : null;

      if (eventType === 'CONVERSATION_MESSAGE') {
        var text = entryPayload && entryPayload.abstractMessage && entryPayload.abstractMessage.staticContent
          ? entryPayload.abstractMessage.staticContent.text
          : null;
        if (text && sender && sender.role && sender.role !== 'EndUser') {
          appendBubble('agent', text);
        }
      } else if (eventType === 'CONVERSATION_CLOSE_CONVERSATION' || eventType === 'CONVERSATION_ROUTING_RESULT_FAILED') {
        handleConversationEndedByServer('This conversation has ended.');
      } else if (eventType === 'CONVERSATION_PARTICIPANT_CHANGED' && entryPayload && entryPayload.entries) {
        // The event's own sender is "Automated Process" (a system entity), not the agent - the
        // real agent identity/name for join and leave both live in each entries[] item instead.
        entryPayload.entries.forEach(function (e) {
          if (!e.participant || e.participant.role !== 'Agent') return;
          if (e.operation === 'add') {
            var subject = e.participant.subject;
            if (subject && !knownAgents[subject]) {
              knownAgents[subject] = true;
              appendBubble('system', (e.displayName || 'An agent') + ' joined the conversation.');
            }
          } else if (e.operation === 'remove') {
            handleConversationEndedByServer('The agent ended this conversation.');
          }
        });
      }
    }

    function handleConversationEndedByServer(message) {
      if (conversationEnded) return;
      conversationEnded = true;
      clearSession();
      appendBubble('system', message);
      chatInput.disabled = true;
      chatSendBtn.disabled = true;
      var endChatBtn = document.getElementById('endChatBtn');
      endChatBtn.disabled = true;
      endChatBtn.textContent = 'Chat ended';
    }

    // Resume a still-open conversation from a previous load of this tab instead of starting a
    // new one. Message history isn't refetched (no transcript endpoint wired up here yet) - the
    // resumed view starts empty aside from this notice, but the underlying MessagingSession and
    // SSE connection are the same ones as before, not a duplicate.
    (function tryResumeSession() {
      var saved = loadSession();
      if (!saved || !saved.accessToken || !saved.conversationId) return;
      accessToken = saved.accessToken;
      conversationId = saved.conversationId;
      lastEventId = saved.lastEventId || null;
      showScreen(chatScreen);
      appendBubble('system', 'Resuming your conversation...');
      chatInput.disabled = false;
      chatSendBtn.disabled = false;
      connectEventStream();
    })();
  })();
  </script>

</body>
</html>`;

app.http('talkToAgentTab', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'talkToAgentTab',
    handler: async () => {
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: PAGE_HTML
        };
    }
});
