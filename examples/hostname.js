var sshPool = require('../');

var pool = new sshPool.ConnectionPool(['neoziro@localhost', 'neoziro@localhost'], 'neoziro@proxyhost');

pool.run('hostname')
.then(function (results) {
  console.log(results[0].stdout);
  console.log(results[1].stdout);
});
