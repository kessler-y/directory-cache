var log = require('log4js').getLogger('DirectoryCache.test');
var vows = require('vows');
var assert = require('assert');
var DirectoryCache = require('../lib/DirectoryCache');
var $u = require('util');
var fs = require('fs');

var TEST_DIR = './DirectoryCacheTestDir';
var DEFAULT_FILE_CONTENT = 'foo.bar';

function setupTestDirectory() {	
	if (fs.existsSync(TEST_DIR))
		cleanup();

	fs.mkdirSync(TEST_DIR);
}

function writeTestFile(name, content) {	
	fs.writeFileSync(TEST_DIR + '/' + name, content || DEFAULT_FILE_CONTENT);
}

function deleteTestFile(name) {
	fs.unlinkSync(TEST_DIR + '/' + name);
}

function cleanup () { 	
	
	var files = fs.readdirSync(TEST_DIR);

	for (var i = 0, len = files.length; i < len; i++)
	    if (files[i] !== '.' && files[i] !== '..')
	        fs.unlinkSync(TEST_DIR + '/' + files[i]);

	fs.rmdirSync(TEST_DIR);
}	

setupTestDirectory();
writeTestFile('1.file');
writeTestFile('2.txt');
writeTestFile('x.json', '{ "x": 1 }');

var suite = vows.describe('DirectoryCache').addBatch({

	'When created, loads the content of files in the directory': {
		topic: function() {			

			var params = {
				directory: TEST_DIR
			};

			var cache = DirectoryCache.create(params);						

			cache.init(this.callback);
		},						
		'check expected files are there': function(err, cache) {			
			
			if (err !== null)
				assert.fail(err);

			assert.strictEqual(cache.getFileContent('1.file'), DEFAULT_FILE_CONTENT);
			assert.strictEqual(cache.getFileContent('2.txt'), DEFAULT_FILE_CONTENT);
			assert.strictEqual(cache.getFileContent('x.json').x, 1);		
		},		
		'when a file is added it should reflect in the cache': {
			topic: function(err, cache) {				
				this.cache = cache;
				cache.once('files added', this.callback);
				writeTestFile('g.t');
			},
			'callback': function(files) {
				assert.lengthOf(files, 1);
				assert.includes(files, 'g.t');
			},			
			'when a file is deleted it should reflect in the cache': {
				topic: function () {
					this.cache.once('files deleted', this.callback);
					deleteTestFile('x.json');
				},
				'callback': function(files) {
					assert.lengthOf(files, 1);
					assert.includes(files, 'x.json');					
					assert.isUndefined(this.getFileContent('x.json'));
				},
				'when json parsing is disabled, json files are read as text': {
					topic: function () {
						this.cache.once('files added', this.callback);
						this.cache.disableJsonParsing();
						writeTestFile('y.json', '{ "x": 1 }');
					},
					'callback': function(files) {
						var content = this.getFileContent('y.json');
						assert.isTrue(typeof(content) === 'string', 'expected a string as contents but got ' + typeof(content));
					},
					teardown: function () {
						this.cache.stop();
					}
				}
			}
		}
	}
});

suite.addBatch({
	'regexp filter': {
		topic: function() {			

			var params = {
				directory: TEST_DIR,
				filter: /.*json/
			};

			var cache = DirectoryCache.create(params);						

			cache.init(this.callback);
		},			
		'check files are filtered properly': function(err, cache) {
			var files = cache.getFiles();

			assert.lengthOf(files, 1);
			assert.includes(files, 'y.json');
		},
		teardown: function(err, cache) {
			cache.stop();
		}
	}
});

suite.addBatch({
	'function filter': {
		topic: function() {			

			var params = {
				directory: TEST_DIR,
				filter: function(file) { return file.slice(-5).toLowerCase() === '.json' }
			};

			var cache = DirectoryCache.create(params);						

			cache.init(this.callback);
		},			
		'check files are filtered properly': function(err, cache) {
			var files = cache.getFiles();
			assert.lengthOf(files, 3);
			assert.includes(files, '1.file');
			assert.includes(files, 'g.t');
			assert.includes(files, '2.txt');
		},
		teardown: function(err, cache) {
			cache.stop();
		}
	}
})


suite.addBatch({
	'count and keys are update properly at initialization': {
		topic: function() {				
			
			var params = {
				directory: TEST_DIR
			};

			var cache = DirectoryCache.create(params);						

			cache.init(this.callback);
		}, 
		'init callback': function(err, topic) {
			
			assert.strictEqual(topic.count, 4);				
			var files = topic.getFiles();
			assert.includes(files, '1.file');
			assert.includes(files, '2.txt');
			assert.includes(files, 'y.json');
			assert.includes(files, 'g.t');
		},
		teardown: function(err, cache) {
			cache.stop();
		}		
	}
});

suite.addBatch({
	'count and keys are update properly at when files are added': {
		topic: function() {				
			
			var params = {
				directory: TEST_DIR
			};

			this.cache = DirectoryCache.create(params);						

			this.cache.init(this.callback);
		}, 
		'init callback': {
			topic: function(err, topic) {
				topic.once('files added', this.callback);
				writeTestFile('t.j');
			},
			'added callback': function(files) {
				assert.strictEqual(this.count, 5);				
				var files = this.getFiles();
				assert.includes(files, '1.file');
				assert.includes(files, '2.txt');
				assert.includes(files, 'y.json');
				assert.includes(files, 'g.t');
				assert.includes(files, 't.j');
			},
			teardown: function() {
				this.cache.stop();
			}		
		}
	}
});


suite.addBatch({
	'count and keys are update properly at when files are Deleted': {
		topic: function() {				
			
			var params = {
				directory: TEST_DIR
			};

			this.cache = DirectoryCache.create(params);						

			this.cache.init(this.callback);
		}, 
		'init callback': {
			topic: function(err, topic) {
				topic.once('files deleted', this.callback);
				deleteTestFile('t.j');
			},
			'added callback': function(files) {
				assert.strictEqual(this.count, 4);				
				var files = this.getFiles();
				assert.includes(files, '1.file');
				assert.includes(files, '2.txt');
				assert.includes(files, 'y.json');
				assert.includes(files, 'g.t');
			},
			teardown: function() {
				this.cache.stop();
			}		
		}
	}
});


suite.addBatch({
	'count and keys remain the same when files are only changed': {
		topic: function() {				
			
			var params = {
				directory: TEST_DIR
			};

			this.cache = DirectoryCache.create(params);						

			this.cache.init(this.callback);
		}, 
		'init callback': {
			topic: function(err, topic) {
				topic.once('files changed', this.callback);
				writeTestFile('g.t');
			},
			'added callback': function(files) {
				assert.strictEqual(this.count, 4);				
				var files = this.getFiles();
				assert.includes(files, '1.file');
				assert.includes(files, '2.txt');
				assert.includes(files, 'y.json');
				assert.includes(files, 'g.t');
			},
			teardown: function() {
				this.cache.stop();
			}		
		}
	}
});

suite.options.error =false;

process.on('exit', function () {
	cleanup();
});

suite.export(module);
