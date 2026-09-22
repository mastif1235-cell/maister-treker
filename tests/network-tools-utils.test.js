'use strict';
/* v91.66: спільна валідація/класифікація цілі для мережевих інструментів.
   Безпека перш за все: схеми, що не є мережевою ціллю, відкидаються до
   будь-якого fetch; приватні адреси маршрутизуються на локальну перевірку. */
const assert=require('node:assert/strict');
const MTNetUtils=require('../js/tools-network-utils.js');

const parse=t=>MTNetUtils.parseTargetInput(t);

/* Порт зберігається лише коли хост валідний (для локальної HTTP-перевірки) */
assert.equal(parse('192.168.1.1:8080').port,'8080');
assert.equal(parse('192.168.1.1:8080').host,'192.168.1.1');
assert.equal(parse('example.com:8080').port,'8080');
assert.equal(parse('1.1.1.1').port,undefined,'no port key without a port');
assert.equal(parse('1.1.1.1:99999').ok,false,'port out of range → invalid host value');
assert.equal(parse('1.1.1.1:0').ok,false);

/* Публічні цілі */
assert.deepEqual(parse('1.1.1.1'),{ok:true,kind:'ipv4',host:'1.1.1.1',local:false});
assert.equal(parse('8.8.8.8').kind,'ipv4');
assert.equal(parse('google.com').kind,'hostname');
assert.equal(parse('GOOGLE.COM').host,'google.com','hostname is lowercased');
assert.equal(parse('2001:4860:4860::8888').kind,'ipv6');
assert.equal(parse('[2001:4860:4860::8888]').host,'2001:4860:4860::8888','brackets are stripped');
assert.equal(parse('  1.1.1.1  ').host,'1.1.1.1','trim');

/* Порта-суфікси й URL зводяться до хоста (шлях не фетчиться) */
assert.equal(parse('1.1.1.1:443').host,'1.1.1.1');
const fromUrl=parse('https://example.com/some/path?q=1');
assert.equal(fromUrl.ok,true);
assert.equal(fromUrl.kind,'hostname');
assert.equal(fromUrl.host,'example.com');
assert.match(fromUrl.note,/some\/path/,'the ignored path is disclosed to the user');

/* Небезпечні схеми — відмова ДО будь-якого fetch */
for(const bad of ['javascript:alert(1)','data:text/html;base64,AAAA','file:///etc/passwd','blob:https://x/1']){
  const result=parse(bad);
  assert.equal(result.ok,false,bad);
  assert.match(result.error,/не можна|не вдалося/i);
}

/* Некоректні значення */
assert.equal(parse('').ok,false);
assert.equal(parse('   ').ok,false);
assert.equal(parse('192.168.1.256').ok,false,'octet >255 rejected');
assert.equal(parse('1.2.3').ok,false,'three octets is not an IPv4 and not a hostname');
assert.equal(parse('not a host!').ok,false);
assert.equal(parse('999.1.1.1').ok,false);
assert.equal(parse('2001:zz::1').ok,false,'invalid IPv6 rejected');

/* Приватні/локальні цілі → local route */
assert.equal(parse('192.168.0.1').local,true);
assert.equal(parse('192.168.1.1').local,true);
assert.equal(parse('10.10.0.97').local,true);
assert.equal(parse('172.16.5.4').local,true);
assert.equal(parse('172.31.255.1').local,true);
assert.equal(parse('172.32.0.1').local,false,'172.32+ is public');
assert.equal(parse('fe80::1').local,true,'link-local v6 is local');
assert.equal(parse('::1').local,true,'loopback v6 is local');
assert.equal(parse('fd00::1234').local,true,'ULA v6 is local');
assert.equal(parse('8.8.4.4').local,false);
assert.equal(parse('2001:4860:4860::8888').local,false);

/* Публічна ціль ніколи не вважається локальною і навпаки */
assert.equal(MTNetUtils.isLocalTarget(parse('192.168.1.1')),true);
assert.equal(MTNetUtils.isLocalTarget(parse('1.1.1.1')),false);

/* Форматування для UI */
assert.equal(MTNetUtils.formatMs(18.4),'18 мс');
assert.equal(MTNetUtils.formatMs(1500),'1,5 с');
assert.equal(MTNetUtils.formatMs(NaN),'—');
assert.equal(MTNetUtils.bpsToMbps(427.44e6),427.4);
assert.equal(MTNetUtils.bpsToMbps(0),null);
assert.equal(MTNetUtils.bpsToMbps(-5),null);
assert.equal(MTNetUtils.bpsToMbps('x'),null);

console.log('PASS network tools utils: target parsing/classification is strict, safe schemes rejected, local vs public routing is correct, units/formatting are stable');
