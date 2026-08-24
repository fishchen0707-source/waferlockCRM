// 信令中繼協定測試：模擬 agent + customer 兩端，驗證 server.js 的 /api/rtc/signal
// 對照 public/js/rtc-client.js 期望的訊息型別。跑法：node test-signal.js
const WebSocket = require('ws');
const URL = 'ws://localhost:3000/api/rtc/signal';
const ROOM = 'test_' + Date.now();
const log = [];
const rec = (who, m) => { log.push(`${who} 收到: ${JSON.stringify(m)}`); };

function client(role) {
  const ws = new WebSocket(URL);
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); rec(role, m); ws.emit('msg', m); });
  return ws;
}

const agent = client('agent');
const customer = client('customer');
const got = { agentJoined: null, custJoined: null, agentPeerJoin: false, custGotOffer: false, agentGotAnswer: false, custGotIce: false, custPeerLeave: false };

agent.on('open', () => agent.send(JSON.stringify({ type: 'join', room: ROOM, role: 'agent' })));
agent.on('msg', (m) => {
  if (m.type === 'joined') got.agentJoined = m.peerPresent;
  if (m.type === 'peer-join') { got.agentPeerJoin = true; // agent 得知對端進來 → 發 offer（模擬）
    agent.send(JSON.stringify({ type: 'offer', sdp: { type: 'offer', sdp: 'FAKE_OFFER' } }));
  }
  if (m.type === 'answer') { got.agentGotAnswer = true; // 收到 answer → 送一個 ice
    agent.send(JSON.stringify({ type: 'ice', candidate: { candidate: 'FAKE_ICE' } }));
    setTimeout(() => customer.close(), 150); // 顧客掛斷 → 驗 peer-leave
  }
});
customer.on('msg', (m) => {
  if (m.type === 'joined') got.custJoined = m.peerPresent;
  if (m.type === 'offer') { got.custGotOffer = true; // 收到 offer → 回 answer
    customer.send(JSON.stringify({ type: 'answer', sdp: { type: 'answer', sdp: 'FAKE_ANSWER' } }));
  }
  if (m.type === 'ice') got.custGotIce = true;
});
agent.on('msg', (m) => { if (m.type === 'peer-leave') got.custPeerLeave = true; });

// agent 先進房，200ms 後 customer 才進 → 驗 peerPresent 邏輯
setTimeout(() => customer.send(JSON.stringify({ type: 'join', room: ROOM, role: 'customer' })), 200);

setTimeout(() => {
  console.log('--- 訊息軌跡 ---'); log.forEach((l) => console.log(l));
  const checks = [
    ['agent 先進房，joined.peerPresent 應為 false', got.agentJoined === false],
    ['customer 後進房，joined.peerPresent 應為 true', got.custJoined === true],
    ['agent 收到 peer-join', got.agentPeerJoin === true],
    ['customer 收到 offer（轉發）', got.custGotOffer === true],
    ['agent 收到 answer（轉發）', got.agentGotAnswer === true],
    ['customer 收到 ice（轉發）', got.custGotIce === true],
    ['customer 掛斷後 agent 收到 peer-leave', got.custPeerLeave === true],
  ];
  console.log('--- 驗證 ---');
  let pass = true;
  checks.forEach(([name, ok]) => { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) pass = false; });
  console.log(pass ? '\n全部通過 ✅' : '\n有失敗 ❌');
  agent.close();
  process.exit(pass ? 0 : 1);
}, 800);
