var $u = require('util');
var events = require('events');
var fs = require('fs');
var path = require('path');
var logger = require('log4js').getLogger('DirectoryCache');
var DirectoryWatcher = require('directory-watcher');
var async = require('async');
var _u = require('underscore');
var vm = require('vm');

/*
	creates a cache over a directory files and their content. cache updates itself using a DirectoryWatcher

	@param directory required, path to the directory we cache
	@param filter an optional parameter can be a function: function filter(file) { return file.indexOf('1') > -1; // will filter files with 1 in their names } or a regular expression
	@param {DirectoryWatcher} watcher optional
	@param initCallback
	@constructor
*/
function DirectoryCache(directory, filter, watcher) {
	events.EventEmitter.call(this);

	this.count = 0; // used to dirty flag keys array created in getFiles() with lastCount
	this.lastCount = 0; 
	this.keys = [];

	this.enableJsonParsing();

	this.directory = directory;	
	this.watcher = watcher;
	
	this.filter = function(file) { return false; };

	if (filter) {
		
		if ($u.isRegExp(filter)) {
			this.filter = function(file) {
				return !filter.test(file);
			};			
		} else {

			// assume function
			this.filter = filter;
		}			
	} 
}

$u.inherits(DirectoryCache, events.EventEmitter);

DirectoryCache.create = function(params) {
	
	if (typeof(params) === 'string')
		return new DirectoryCache(params, undefined, undefined);
	else
		return new DirectoryCache(params.directory, params.filter, params.watcher);
};

DirectoryCache.prototype.init = function(initCallback) {
	var self = this;

	var watcher = self.watcher;	
	var directory = self.directory;

	self.cache = {};	

	logger.debug('creating directory cache for [%s]', directory);
	
	
	// the initialization sequence is executed here
	async.waterfall([
		readInitially,
		grabFiles,
		connectToWatcher
	], initSequenceDone);

	// read the content of the directory
	function readInitially(callback) {
		fs.readdir(directory, callback);
	}

	// get the content of the files in parallel, possibly applying a filter
	// the parallel reports back to the callback of the waterfall sequence
	function grabFiles(files, callback) {
		var functors = [];

		for (var i = 0; i < files.length; i++) {
			if(!self.filter(files[i]))
				functors.push(addFile(files[i]));
		}

		async.parallel(functors, callback);

		function addFile (file) {			
			return function(parallelCallback) {								
				self.addFile(directory, file, parallelCallback);								
			};
		};
	}

	// after grabbing the files, attach to the watcher events to maintain the cache
	function connectToWatcher(files, callback) {

		if (watcher) {
			connectToWatcherImpl(null, watcher, callback);
		} else {
			DirectoryWatcher.create(directory, function(err, _watcher) {
				connectToWatcherImpl(err, _watcher, callback)
			});
		}
	}

	function connectToWatcherImpl(err, _watcher, callback) {

		if (err !== null) {
			callback(err);
			return;
		}

		self.watcher = _watcher;

		_watcher.on('deleted', onFilesDeletedEvent);

		_watcher.on('added', onFilesAddedEvent);

		_watcher.on('changed', onFilesChangedEvent);

		// events are hooked, call back
		callback(null, self);

		function onFilesDeletedEvent(files) {
			logger.debug('deleted: [%s]', files);

			for (var i = 0; i < files.length; i++) {							
				self.deleteFile(files[i]);			
			}	

			self.emit('files deleted', files);
		}

		function onFilesAddedEvent(files) {			
			logger.debug('added: [%s]', files);			
			grabFiles(files, function(err, results) {
				if (err !== null) {
					logger.error(err);
				} else {
					self.emit('files added', results);
				}
			});
		}

		function onFilesChangedEvent(files) {
			logger.debug('changed: [%s]', files);			
			grabFiles(files, function(err, results) {	
				if (err !== null) {
					logger.error(err);
				} else {
					self.emit('files changed', results);
				}
			});
		}
	}

	function initSequenceDone(err, results) {
		if (err !== null) {
			logger.error(err);
			initCallback(err);			
		} else {			
			initCallback(null, self);
		}
	}
}

DirectoryCache.prototype.getFiles = function() {
	if (this.lastCount !== this.count) {
		this.keys = _u.keys(this.cache);
		this.lastCount = this.count;
	}

	return this.keys;
};

DirectoryCache.prototype.stop = function() {
	if (this.watcher) {
		this.watcher.kill();		
	} 
};

DirectoryCache.prototype.addFile = function(directory, file, callback) {
	var self = this;

	var json = self.parseJson && isJsonFile(file);

	var encoding = json ? undefined: 'utf8';

	fs.readFile(path.join(directory, file), encoding, function(err, data) {
		
		if (err !== null) {			
			callback(err);

		} else if (data.length > 0) {

			if (json) {
				data = JSON.parse(data);
			} 

			// lame way to check this out since i have change vs added event but meh
			if (typeof(self.cache[file]) === 'undefined')				
				self.count++;

			self.cache[file] = data;

			callback(null, file);
		}				
	});
};

DirectoryCache.prototype.deleteFile = function(file) {
	delete this.cache[file];
	this.count--;
	this.emit('deleted', file);
};

DirectoryCache.prototype.getFileContent = function(file) {
	return this.cache[file];
};

DirectoryCache.prototype.disableJsonParsing = function() {
	this.parseJson = false;
};

DirectoryCache.prototype.enableJsonParsing = function() {
	this.parseJson = true;
};

function isJsonFile(filename) {
	return filename.slice(-5).toLowerCase() === '.json';
}


module.exports = DirectoryCache;