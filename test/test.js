var tapeTest = require('tape')
var Store = require('safe-fs-blob-store')
var mkdirp = require('mkdirp')
var pump = require('pump')
var tmp = require('tempy')
var rimraf = require('rimraf')
var fs = require('fs')
var path = require('path')
var replicate = require('..')
var http = require('http')
var websocket = require('websocket-stream')

function test (name, run) {
  tapeTest(name, function (t) {
    var dir = tmp.directory()
    mkdirp(dir, () => {
      run(t, dir, cleanup)
      function cleanup () {
        rimraf.sync(dir)
      }
    })
  })
}

test('empty <-> empty', function (t, dir, done) {
  var root1 = path.join(dir, '1')
  var store1 = Store(root1)
  var root2 = path.join(dir, '2')
  var store2 = Store(root2)

  replicateStores(store1, store2, check)

  function check (err) {
    t.error(err)
    done()
    t.end()
  }
})

test('1 file <-> empty', function (t, dir, done) {
  t.plan(5)

  var root1 = path.join(dir, '1')
  var store1 = Store(root1)
  var root2 = path.join(dir, '2')
  var store2 = Store(root2)

  var ws = store1.createWriteStream('2010-01-01_foo.png')
  ws.on('finish', function () {
    replicateStores(store1, store2, check)
  })
  ws.on('error', function (err) {
    t.error(err)
  })
  ws.write('hello')
  ws.end()

  function check (err) {
    t.error(err)
    store1.exists('2010-01-01_foo.png', function (err, exists) {
      t.error(err)
      t.ok(exists, 'exists in original store')
    })
    store2.exists('2010-01-01_foo.png', function (err, exists) {
      t.error(err)
      t.ok(exists, 'exists in remote store')
    })
    done()
  }
})

test('replication stream: 3 files <-> 2 files (1 common)', function (t, dir, done) {
  t.plan(26)

  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1, subDirPrefixLen: 7})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2, subDirPrefixLen: 7})

  var pending = 5
  writeFile(store1, '2010-01-01_foo.png', 'hello', written)
  writeFile(store1, '2010-01-05_bar.png', 'goodbye', written)
  writeFile(store1, '1976-12-17_quux.png', 'unix', written)
  writeFile(store2, '1900-01-01_first.png', 'elder', written)
  writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

  function written (err) {
    t.error(err)
    if (--pending === 0) replicateStores(store1, store2, check)
  }

  function check (err) {
    t.error(err)

    // Four files in each store
    t.equal(fs.readdirSync(root1).length, 3)
    t.equal(fs.readdirSync(root2).length, 3)

    // Two files in the 2010-01 subdir
    t.equal(fs.readdirSync(path.join(root1, '2010-01')).length, 2)
    t.equal(fs.readdirSync(path.join(root2, '2010-01')).length, 2)

    // Check all files: store 1
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.ok(fs.existsSync(path.join(root1, '1976-12')))
    t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
    t.ok(fs.existsSync(path.join(root1, '1900-01')))
    t.equal(fs.readFileSync(path.join(root1, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    // Check all files: store 2
    t.ok(fs.existsSync(path.join(root2, '2010-01')))
    t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
    t.ok(fs.existsSync(path.join(root2, '2010-01')))
    t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.ok(fs.existsSync(path.join(root2, '1976-12')))
    t.equal(fs.readFileSync(path.join(root2, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
    t.ok(fs.existsSync(path.join(root2, '1900-01')))
    t.equal(fs.readFileSync(path.join(root2, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    done()
  }
})

test('websocket replication', function (t, dir, done) {
  t.plan(7)

  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2})

  var wss, web

  writeFile(store1, 'foo.txt', 'bar', function (err) {
    t.error(err)
    t.equal(fs.readdirSync(root1).length, 1)
    t.ok(fs.existsSync(path.join(root1, 'fo', 'foo.txt')), 'file written')

    // server
    web = http.createServer()
    web.listen(2389)
    wss = websocket.createServer({server:web}, function (socket) {
      var rs = replicate(store2)
      rs.pipe(socket).pipe(rs)
    })

    // client
    var ws = websocket(`ws://localhost:2389`, {
      perMessageDeflate: false,
      binary: true
    })
    var r1 = replicate(store1)
    pump(r1, ws, r1, (err) => {
      t.error(err)
      t.ok(true, 'replication ended')
      t.ok(fs.existsSync(path.join(root2, 'fo', 'foo.txt')))
      t.equal(fs.readFileSync(path.join(root2, 'fo', 'foo.txt'), 'utf8'), 'bar')

      web.close(done)
    })
  })
})

test('pull-mode: 3 files <-> 2 files (1 common)', function (t, dir, done) {
  t.plan(24)

  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1, subDirPrefixLen: 7})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2, subDirPrefixLen: 7})

  var pending = 5
  writeFile(store1, '2010-01-01_foo.png', 'hello', written)
  writeFile(store1, '2010-01-05_bar.png', 'goodbye', written)
  writeFile(store1, '1976-12-17_quux.png', 'unix', written)
  writeFile(store2, '1900-01-01_first.png', 'elder', written)
  writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

  function written (err) {
    t.error(err)
    if (--pending === 0) replicateStores(store1, store2, { s1: { mode: 'pull' } }, check)
  }

  function check (err) {
    t.error(err)

    t.equal(fs.readdirSync(root1).length, 3)
    t.equal(fs.readdirSync(root2).length, 2)

    // Two files in the 2010-01 subdir
    t.equal(fs.readdirSync(path.join(root1, '2010-01')).length, 2)
    t.equal(fs.readdirSync(path.join(root2, '2010-01')).length, 1)

    // Check all files: store 1
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.ok(fs.existsSync(path.join(root1, '1976-12')))
    t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
    t.ok(fs.existsSync(path.join(root1, '1900-01')))
    t.equal(fs.readFileSync(path.join(root1, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    // Check all files: store 2
    t.ok(fs.existsSync(path.join(root2, '1900-01')))
    t.equal(fs.readFileSync(path.join(root2, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')
    t.ok(fs.existsSync(path.join(root2, '2010-01')))
    t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.notOk(fs.existsSync(path.join(root2, '2010-01', '2010-01-01_foo.png'), 'utf8'))
    t.notOk(fs.existsSync(path.join(root2, '1976-12', '1976-12-17_quux.png'), 'utf8'))

    done()
  }
})

test('push-mode: 3 files <-> 2 files (1 common)', function (t, dir, done) {
  t.plan(24)

  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1, subDirPrefixLen: 7})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2, subDirPrefixLen: 7})

  var pending = 5
  writeFile(store1, '2010-01-01_foo.png', 'hello', written)
  writeFile(store1, '2010-01-05_bar.png', 'goodbye', written)
  writeFile(store1, '1976-12-17_quux.png', 'unix', written)
  writeFile(store2, '1900-01-01_first.png', 'elder', written)
  writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

  function written (err) {
    t.error(err)
    if (--pending === 0) replicateStores(store1, store2, { s2: { mode: 'push' } }, check)
  }

  function check (err) {
    t.error(err)

    // Four files in each store
    t.equal(fs.readdirSync(root1).length, 3)
    t.equal(fs.readdirSync(root2).length, 2)

    // Two files in the 2010-01 subdir
    t.equal(fs.readdirSync(path.join(root1, '2010-01')).length, 2)
    t.equal(fs.readdirSync(path.join(root2, '2010-01')).length, 1)

    // Check all files: store 1
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.ok(fs.existsSync(path.join(root1, '1976-12')))
    t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
    t.ok(fs.existsSync(path.join(root1, '1900-01')))
    t.equal(fs.readFileSync(path.join(root1, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    // Check all files: store 2
    t.ok(fs.existsSync(path.join(root2, '2010-01')))
    t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.ok(fs.existsSync(path.join(root2, '1900-01')))
    t.equal(fs.readFileSync(path.join(root2, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')
    t.notOk(fs.existsSync(path.join(root2, '2010-01', '2010-01-01_foo.png'), 'utf8'))
    t.notOk(fs.existsSync(path.join(root2, '1976-12', '1976-12-17_quux.png'), 'utf8'))

    done()
  }
})

test('both sides in push-mode: no files xferred', function (t, dir, done) {
  t.plan(11)

  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1, subDirPrefixLen: 7})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2, subDirPrefixLen: 7})

  var pending = 2
  writeFile(store1, '1976-12-17_quux.png', 'unix', written)
  writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

  function written (err) {
    t.error(err)
    var opts = {
      s1: { mode: 'push' },
      s2: { mode: 'push' }
    }
    if (--pending === 0) replicateStores(store1, store2, opts, check)
  }

  function check (err) {
    t.error(err)

    t.equal(fs.readdirSync(root1).length, 1)
    t.equal(fs.readdirSync(root2).length, 1)

    t.equal(fs.readdirSync(path.join(root1, '1976-12')).length, 1)
    t.equal(fs.readdirSync(path.join(root2, '2010-01')).length, 1)

    // Check all files: store 1
    t.ok(fs.existsSync(path.join(root1, '1976-12')))
    t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')

    // Check all files: store 2
    t.ok(fs.existsSync(path.join(root2, '2010-01')))
    t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')

    done()
  }
})

test('subdirectory', function (t, dir, done) {
  t.plan(5)

  var root1 = path.join(dir, '1')
  var store1 = Store(root1)
  var root2 = path.join(dir, '2')
  var store2 = Store(root2)

  var ws = store1.createWriteStream('original/fa1ee1d1b61d9afcc99b1a8bd9b690ac.jpg')
  ws.on('finish', function () {
    replicateStores(store1, store2, check)
  })
  ws.on('error', function (err) {
    t.error(err)
  })
  ws.write('hello')
  ws.end()

  function check (err) {
    t.error(err)
    store1.exists('original/fa1ee1d1b61d9afcc99b1a8bd9b690ac.jpg', function (err, exists) {
      t.error(err)
      t.ok(exists, 'exists in original store')
    })
    store2.exists('original/fa1ee1d1b61d9afcc99b1a8bd9b690ac.jpg', function (err, exists) {
      t.error(err)
      t.ok(exists, 'exists in remote store')
    })
    done()
  }
})

test('opts.filter', function (t, dir, done) {
  t.plan(24)

  function filterFn (name) {
    return /foo/.test(name)
  }

  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1, subDirPrefixLen: 7})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2, subDirPrefixLen: 7})

  var pending = 5
  writeFile(store1, '2010-01-01_foo.png', 'hello', written)
  writeFile(store1, '2010-01-05_bar.png', 'goodbye', written)
  writeFile(store1, '1976-12-17_quux.png', 'unix', written)
  writeFile(store2, '1900-01-01_first.png', 'elder', written)
  writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

  function written (err) {
    t.error(err)
    if (--pending === 0) replicateStores(store1, store2, {s1:{filter:filterFn}}, check)
  }

  function check (err) {
    t.error(err)

    // Four files in each store
    t.equal(fs.readdirSync(root1).length, 3)
    t.equal(fs.readdirSync(root2).length, 2)

    // Two files in the 2010-01 subdir
    t.equal(fs.readdirSync(path.join(root1, '2010-01')).length, 2)
    t.equal(fs.readdirSync(path.join(root2, '2010-01')).length, 2)

    // Check all files: store 1
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
    t.ok(fs.existsSync(path.join(root1, '2010-01')))
    t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
    t.ok(fs.existsSync(path.join(root1, '1976-12')))
    t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
    t.ok(fs.existsSync(path.join(root1, '1900-01')))
    t.equal(fs.readFileSync(path.join(root1, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    // Check all files: store 2
    t.ok(fs.existsSync(path.join(root2, '2010-01')))
    t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
    t.notOk(fs.existsSync(path.join(root2, '1976-12')))
    t.notOk(fs.existsSync(path.join(root2, '1976-12', '1976-12-17_quux.png')))
    t.ok(fs.existsSync(path.join(root2, '1900-01')))
    t.equal(fs.readFileSync(path.join(root2, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    done()
  }
})

test('size zero file', function (t, dir, done) {
  t.plan(5)

  var root1 = path.join(dir, '1')
  var store1 = Store(root1)
  var root2 = path.join(dir, '2')
  var store2 = Store(root2)

  var ws = store1.createWriteStream('empty.txt')
  ws.on('finish', function () {
    replicateStores(store1, store2, check)
  })
  ws.on('error', function (err) {
    t.error(err)
  })
  ws.end()

  function check (err) {
    t.error(err)
    store1.exists('empty.txt', function (err, exists) {
      t.error(err)
      t.ok(exists, 'exists in original store')
    })
    store2.exists('empty.txt', function (err, exists) {
      t.error(err)
      t.ok(exists, 'exists in remote store')
    })
    done()
  }
})

test('size zero file + a non-zero file', function (t, dir, done) {
  t.plan(11)

  var root1 = path.join(dir, '1')
  var store1 = Store(root1)
  var root2 = path.join(dir, '2')
  var store2 = Store(root2)

  var pending = 2

  var ws1 = store1.createWriteStream('empty.txt')
  ws1.on('finish', written)
  ws1.on('error', written)
  ws1.end()

  var ws2 = store1.createWriteStream('hello.txt')
  ws2.on('finish', written)
  ws2.on('error', written)
  ws2.end('hello world')

  function written (err) {
    t.error(err)
    if (!--pending) replicateStores(store1, store2, check)
  }

  function check (err) {
    t.error(err)
    store1.exists('empty.txt', function (err, exists) {
      t.error(err)
      t.ok(exists, 'empty.txt exists in original store')
    })
    store1.exists('hello.txt', function (err, exists) {
      t.error(err)
      t.ok(exists, 'hello.txt exists in original store')
    })
    store2.exists('empty.txt', function (err, exists) {
      t.error(err)
      t.ok(exists, 'empty.txt exists in remote store')
    })
    store2.exists('hello.txt', function (err, exists) {
      t.error(err)
      t.ok(exists, 'hello.txt exists in remote store')
    })
  }
})

function writeFile (store, name, data, done) {
  var ws = store.createWriteStream(name)
  ws.on('finish', done)
  ws.on('error', done)
  ws.write(data)
  ws.end()
}

test('progress events', function (t, dir, done) {
  t.plan(14)
  var root1 = path.join(dir, '1')
  var store1 = Store({path: root1, subDirPrefixLen: 7})
  var root2 = path.join(dir, '2')
  var store2 = Store({path: root2, subDirPrefixLen: 7})
  var lastSofar1, lastTotal1
  var lastSofar2, lastTotal2

  var pending = 9
  writeFile(store1, '2010-01-01_foo.png', 'hello', written)
  writeFile(store1, '1976-12-17_quux.png', 'unix', written)
  writeFile(store1, '1986-12-17_quux.png', 'boop', written)

  writeFile(store1, '2010-01-05_bar.png', 'goodbye', written)
  writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

  writeFile(store2, '1900-01-01_first.png', 'elder', written)
  writeFile(store2, '2010-01-07_baz.png', 'goodbaz', written)
  writeFile(store2, '2010-01-07_beezonk.png', 'goodbaz', written)
  writeFile(store2, '2010-01-05_bizonk.png', 'goodbizonk', written)

  function written (err) {
    t.error(err, 'file setup write ok')
    if (--pending === 0) {
      sync()
    }
  }

  function sync () {
    var r1 = replicate(store1)
    var r2 = replicate(store2)

    r1.on('progress', function (sofar, total) {
      lastSofar1 = sofar
      lastTotal1 = total
    })
    r2.on('progress', function (sofar, total) {
      lastSofar2 = sofar
      lastTotal2 = total
    })

    pump(r1, r2, r1, (err) => {
      t.error(err, 'sync ok')
      check()
    })
  }

  function check () {
    t.equals(lastSofar1, 7, 'sofar A good')
    t.equals(lastTotal1, 7, 'total A good')
    t.equals(lastSofar2, 7, 'sofar B good')
    t.equals(lastTotal2, 7, 'total B good')
    done()
  }
})

function replicateStores (s1, s2, opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  opts.s1 = opts.s1 || {}
  opts.s2 = opts.s2 || {}

  var r1 = replicate(s1, opts.s1)
  var r2 = replicate(s2, opts.s2)

  pump(r1, r2, r1, cb)
}
