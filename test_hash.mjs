import bcrypt from 'bcrypt';

const hash = '$2b$10$6Or8OBoLQ.3SGVfM5ywxTOcAwO3Ar8RUqwG7VxCLQfwBr4t1ycq.m';
const passwordsToTest = ['Vendor@123', 'admin', 'password', '123456', 'Vendor@1234', 'Admin@123', 'vendor123'];

async function test() {
  for (let p of passwordsToTest) {
    let match = await bcrypt.compare(p, hash);
    if (match) {
      console.log('Password is:', p);
      return;
    }
  }
  console.log('Password not found in list');
}

test();
