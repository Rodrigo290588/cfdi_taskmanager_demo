async function test() {
  const res = await fetch('http://localhost:3000/api/companies/test-id/logo', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=---123' },
    body: '-----123\r\nContent-Disposition: form-data; name="logo"; filename="test.png"\r\nContent-Type: image/png\r\n\r\ntest\r\n-----123--\r\n'
  });
  const text = await res.text();
  console.log('STATUS:', res.status);
  console.log('BODY:', text);
}
test();