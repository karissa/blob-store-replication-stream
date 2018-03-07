var tapeTest = require('tape')
var Store = require('safe-fs-blob-store')
var tmp = require('tempy')
var rimraf = require('rimraf')
var fs = require('fs')
var path = require('path')
var replicate = require('..')

function test (name, run) {
  tapeTest(name, function (t) {
    var dir = tmp.directory()
    run(t, dir, cleanup)
    function cleanup () {
      rimraf.sync(dir)
    }
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

// test('3 files <-> 2 files (1 in common)', function (t, dir, done) {
//   var root1 = path.join(dir, '1')
//   var store1 = Store(root1)
//   var root2 = path.join(dir, '2')
//   var store2 = Store(root2)

//   var pending = 4
//   writeFile(store1, '2010-01-01_foo.png', 'hello', written)
//   writeFile(store1, '2010-01-05_bar.png', 'goodbye', written)
//   writeFile(store1, '1976-12-17_quux.png', 'unix', written)
//   writeFile(store2, '1900-01-01_first.png', 'elder', written)
//   writeFile(store2, '2010-01-05_bar.png', 'goodbye', written)

//   function written (err) {
//     t.error(err)
//     if (--pending === 0) replicate()
//   }

//   function replicate () {
//     replicateStores(store1, store2, check)
//   }

//   function check (err) {
//     t.error(err)

//     // Four files in each store
//     t.equal(fs.readdirSync(root1).length, 4)
//     t.equal(fs.readdirSync(root2).length, 4)

//     // Two files in the 2010-01 subdir
//     t.equal(fs.readdirSync(path.join(root1, '2010-01')).length, 2)
//     t.equal(fs.readdirSync(path.join(root2, '2010-01')).length, 2)

//     // Check all files: store 1
//     t.ok(fs.existsSync(path.join(root1, '2010-01')))
//     t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
//     t.ok(fs.existsSync(path.join(root1, '2010-01')))
//     t.equal(fs.readFileSync(path.join(root1, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
//     t.ok(fs.existsSync(path.join(root1, '1976-12')))
//     t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
//     t.ok(fs.existsSync(path.join(root1, '1976-12')))
//     t.equal(fs.readFileSync(path.join(root1, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
//     t.ok(fs.existsSync(path.join(root1, '1900-01')))
//     t.equal(fs.readFileSync(path.join(root1, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

//     // Check all files: store 2
//     t.ok(fs.existsSync(path.join(root2, '2010-01')))
//     t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-01_foo.png'), 'utf8'), 'hello')
//     t.ok(fs.existsSync(path.join(root2, '2010-01')))
//     t.equal(fs.readFileSync(path.join(root2, '2010-01', '2010-01-05_bar.png'), 'utf8'), 'goodbye')
//     t.ok(fs.existsSync(path.join(root2, '1976-12')))
//     t.equal(fs.readFileSync(path.join(root2, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
//     t.ok(fs.existsSync(path.join(root2, '1976-12')))
//     t.equal(fs.readFileSync(path.join(root2, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
//     t.ok(fs.existsSync(path.join(root2, '1900-01')))
//     t.equal(fs.readFileSync(path.join(root2, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

//     done()
//     t.end()
//   }
// })

// // Simulate a stream error + partial write
// test('partial write failure', function (t, dir, done) {
//   var root = path.join(dir, '1')
//   var store = Store(root)

//   var ws = store.createWriteStream('2010-01-01_foo.png')

//   ws.on('finish', function () {
//     t.fail('should not have finished')
//   })
//   ws.on('error', check)
//   ws.write('hello ')
//   ws.write('there')
//   setTimeout(function () {
//     ws.emit('error', new Error('breakage'))
//   }, 100)

//   function check (err) {
//     t.ok(err)
//     t.notOk(fs.existsSync(path.join(root, '2010-01')))
//     done()
//     t.end()
//   }
// })

test('replication stream: 3 files <-> 2 files (1 common)', function (t, dir, done) {
  t.plan(30)

  var root1 = path.join(dir, '1')
  var store1 = Store(root1)
  var root2 = path.join(dir, '2')
  var store2 = Store(root2)

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

  // function replicate () {
  //   var r1 = store1.replicateStream()
  //   var r2 = store2.replicateStream()
  //   r1.pipe(r2).pipe(r1)
  //   r1.on('end', check)
  //   r2.on('end', check)
  // }

  function check (err) {
    t.error(err)

    // Four files in each store
    t.equal(fs.readdirSync(root1).length, 4)
    t.equal(fs.readdirSync(root2).length, 4)

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
    t.ok(fs.existsSync(path.join(root2, '1976-12')))
    t.equal(fs.readFileSync(path.join(root2, '1976-12', '1976-12-17_quux.png'), 'utf8'), 'unix')
    t.ok(fs.existsSync(path.join(root2, '1900-01')))
    t.equal(fs.readFileSync(path.join(root2, '1900-01', '1900-01-01_first.png'), 'utf8'), 'elder')

    // done()
    // t.end()
  }
})

function writeFile (store, name, data, done) {
  var ws = store.createWriteStream(name)
  ws.on('finish', done)
  ws.on('error', done)
  ws.write(data)
  ws.end()
}

function replicateStores (s1, s2, cb) {
  var r1 = replicate(s1)
  var r2 = replicate(s2)
  r1.pipe(r2).pipe(r1)
  r1.on('end', check)
  r1.on('error', check)
  r2.on('end', check)
  r2.on('error', check)

  var pending = 2
  function check (err) {
    if (err) {
      pending = Infinity
      cb(err)
    }
    if (!--pending) cb()
  }
}