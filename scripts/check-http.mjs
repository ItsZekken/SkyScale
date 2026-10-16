import http from 'http';

function testUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, length: data.length }));
    }).on('error', reject);
  });
}

const r1 = await testUrl('http://localhost:5178/');
console.log('GET http://localhost:5178/ -> status:', r1.status, 'bytes:', r1.length);
const r2 = await testUrl('http://localhost:5178/src/main.js');
console.log('GET http://localhost:5178/src/main.js -> status:', r2.status, 'bytes:', r2.length);
