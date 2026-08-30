import { parseInboundMessage } from "../packages/providers/src/inbound.js";
let f=0; const ok=(n:string,c:boolean,x="")=>{console.log((c?"✓":"✗")+" "+n+(x?" — "+x:"")); if(!c)f++;};

// 1) multipart/alternative + base64 html + QP text + RFC2047 subject
const mp = [
"From: Ann Lee <ann@acme.com>","To: hi@yourdomain.com",
"Subject: =?UTF-8?Q?Sch=C3=B6ne_Gr=C3=BC=C3=9Fe?=","Message-ID: <abc123@acme.com>",
'Content-Type: multipart/alternative; boundary="b"',"",
"--b","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: quoted-printable","",
"Hello =E2=9C=93 world","","--b","Content-Type: text/html","Content-Transfer-Encoding: base64","",
Buffer.from("<p>Hello <b>world</b></p>").toString("base64"),"","--b--",""].join("\r\n");
const a = parseInboundMessage(mp);
ok("from decoded", a.from==="Ann Lee <ann@acme.com>");
ok("subject RFC2047 (QP)", a.subject==="Schöne Grüße", a.subject);
ok("messageId", a.messageId==="<abc123@acme.com>");
ok("text QP-decoded", a.text?.includes("Hello ✓ world")===true, JSON.stringify(a.text));
ok("html base64-decoded", a.html==="<p>Hello <b>world</b></p>", a.html);
ok("snippet from text", a.snippet.startsWith("Hello"));

// 2) plain single-part
const pt=["From: x@y.com","To: a@b.com","Subject: Plain","","Just text here"].join("\r\n");
const b=parseInboundMessage(pt);
ok("plain text", b.text==="Just text here" && b.subject==="Plain" && !b.html);

// 3) html-only → snippet strips tags
const ht=["From: x@y.com","To: a@b.com","Subject: H","Content-Type: text/html","","<h1>Hi</h1><p>there &amp; friend</p>"].join("\r\n");
const c=parseInboundMessage(ht);
ok("html snippet stripped", c.snippet.includes("Hi") && c.snippet.includes("there & friend") && !c.snippet.includes("<"), c.snippet);

console.log(f===0?"\nALL PASS":`\n${f} FAIL`); process.exit(f?1:0);
