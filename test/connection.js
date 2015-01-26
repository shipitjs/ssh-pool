var rewire = require('rewire');
var expect = require('chai').use(require('sinon-chai')).expect;
var stdMocks = require('std-mocks');
var childProcess = require('./mocks/child-process');
var Connection = rewire('../lib/connection');

describe('SSH Connection', function () {
  beforeEach(function () {
    Connection.__set__('exec', childProcess.exec.bind(childProcess));
  });

  afterEach(function () {
    childProcess.restore();
  });

  afterEach(function () {
    stdMocks.flush();
    stdMocks.restore();
  });

  describe('constructor', function () {
    it('should accept remote object', function () {
      var connection = new Connection({
        remote: {user: 'user', host: 'host'}
      });
      expect(connection.remote).to.have.property('user', 'user');
      expect(connection.remote).to.have.property('host', 'host');
    });

    it('should accept remote string', function () {
      var connection = new Connection({
        remote: 'user@host'
      });
      expect(connection.remote).to.have.property('user', 'user');
      expect(connection.remote).to.have.property('host', 'host');
    });
  });

  describe('#run', function () {
    var connection;

    beforeEach(function () {
      connection = new Connection({
        remote: 'user@host'
      });
    });

    it('should call childProcess.exec', function (done) {
      connection.run('my-command -x', {cwd: '/root'}, done);

      expect(childProcess.exec).to.be.calledWith(
        'ssh user@host "my-command -x"',
        {cwd: '/root', maxBuffer: 1000 * 1024}
      );
    });

    it('should escape double quotes', function (done) {
      connection.run('echo "ok"', {cwd: '/root'}, done);

      expect(childProcess.exec).to.be.calledWith(
        'ssh user@host "echo \\"ok\\""',
        {cwd: '/root', maxBuffer: 1000 * 1024}
      );
    });

    it('should handle childProcess.exec callback correctly', function (done) {
      connection.run('my-command -x', {cwd: '/root'}, function(err, res) {
        if (err) return done(err);
        expect(res.stdout).to.eql('stdout');
        expect(res.stderr).to.eql('stderr');
        done();
      });
    });

    it('should handle sudo', function (done) {
      connection.run('sudo my-command -x', {cwd: '/root'}, done);

      expect(childProcess.exec).to.be.calledWith(
        'ssh -tt user@host "sudo my-command -x"',
        {cwd: '/root', maxBuffer: 1000 * 1024}
      );
    });

    it('should copy args', function () {
      connection.run('my-command -x', function () {});
      connection.run('my-command2 -x', function () {});

      expect(childProcess.exec).to.be.calledWith(
        'ssh user@host "my-command -x"'
      );

      expect(childProcess.exec).to.be.calledWith(
        'ssh user@host "my-command2 -x"'
      );
    });

    it('should use key if present', function () {
      connection = new Connection({
        remote: 'user@host',
        key: '/path/to/key'
      });
      connection.run('my-command -x', function () {});
      expect(childProcess.exec).to.be.calledWith(
        'ssh -i /path/to/key user@host "my-command -x"'
      );
    });

    it('should use port if present', function () {
      connection = new Connection({
        remote: 'user@host:12345'
      });
      connection.run('my-command -x', function () {});
      expect(childProcess.exec).to.be.calledWith(
        'ssh -p 12345 user@host "my-command -x"'
      );
    });

    it('should use port and key if both are present', function () {
      connection = new Connection({
        remote: 'user@host:12345',
        key: '/path/to/key'
      });
      connection.run('my-command -x', function () {});
      expect(childProcess.exec).to.be.calledWith(
        'ssh -p 12345 -i /path/to/key user@host "my-command -x"'
      );
    });

    it('should log output', function (done) {
      connection = new Connection({
        remote: 'user@host',
        log: console.log.bind(console),
        stdout: process.stdout,
        stderr: process.stderr
      });

      stdMocks.use();
      connection.run('my-command -x', function (err, res) {
        res.child.stdout.push('first line\n');
        res.child.stdout.push(null);

        res.child.stderr.push('an error\n');
        res.child.stderr.push(null);


        var output = stdMocks.flush();
        expect(output.stdout[0]).to.equal('Running "my-command -x" on host "host".\n');
        expect(output.stdout[1].toString()).to.equal('@host first line\n');

        expect(output.stderr[0].toString()).to.equal('@host-err an error\n');

        stdMocks.restore();
        done();
      });
    });
  });

  describe('#copy', function () {
    var connection;

    beforeEach(function () {
      connection = new Connection({
        remote: 'user@host'
      });
    });

    it('should call cmd.spawn', function (done) {
      connection.copy('/src/dir', '/dest/dir', done);

      expect(childProcess.exec).to.be.calledWith('rsync -az -e "ssh " /src/dir user@host:/dest/dir');
    });

    it('should accept "ignores" option', function (done) {
      connection.copy('/src/dir', '/dest/dir', {ignores: ['a', 'b']}, done);

      expect(childProcess.exec).to.be.calledWith('rsync --exclude "a" --exclude "b" -az -e ' +
        '"ssh " /src/dir user@host:/dest/dir');
    });

    it('should accept "remoteSrc" option', function (done) {
      connection.copy('/src/dir', '/dest/dir', {remoteSrc: true}, done);

      expect(childProcess.exec).to.be.calledWith('rsync -az -e "ssh " user@host:/src/dir /dest/dir');
    });

    it('should accept "remoteDest" option', function (done) {
      connection.copy('/src/dir', '/dest/dir', {remoteDest: true}, done);

      expect(childProcess.exec).to.be.calledWith('rsync -az -e "ssh " /src/dir user@host:/dest/dir');
    });

    it('should use key if present', function (done) {
      connection = new Connection({
        remote: 'user@host',
        key: '/path/to/key'
      });
      connection.copy('/src/dir', '/dest/dir', done);
      expect(childProcess.exec).to.be.calledWith('rsync -az -e "ssh -i /path/to/key" /src/dir user@host:/dest/dir');
    });

    it('should use port if present', function (done) {
      connection = new Connection({
        remote: 'user@host:12345'
      });
      connection.copy('/src/dir', '/dest/dir', done);
      expect(childProcess.exec).to.be.calledWith('rsync -az -e "ssh -p 12345" /src/dir user@host:/dest/dir');
    });

    it('should use port and key if both are present', function (done) {
      connection = new Connection({
        remote: 'user@host:12345',
        key: '/path/to/key'
      });
      connection.copy('/src/dir', '/dest/dir', done);
      expect(childProcess.exec).to.be.calledWith('rsync -az -e "ssh -p 12345 -i /path/to/key" /src/dir user@host:/dest/dir');
    });

    it('should log output', function (done) {
      connection = new Connection({
        remote: 'user@host',
        log: console.log.bind(console),
        stdout: process.stdout,
        stderr: process.stderr
      });

      stdMocks.use();
      connection.copy('/src/dir', '/dest/dir', function (err, res) {
        res.child.stdout.push('first line\n');
        res.child.stdout.push(null);

        res.child.stderr.push('an error\n');
        res.child.stderr.push(null);


        var output = stdMocks.flush();
        expect(output.stdout[0]).to.equal('Remote copy "/src/dir" to "user@host:/dest/dir"\n');
        expect(output.stdout[1].toString()).to.equal('@host first line\n');

        expect(output.stderr[0].toString()).to.equal('@host-err an error\n');

        stdMocks.restore();
        done();
      });
    });
  });
});
