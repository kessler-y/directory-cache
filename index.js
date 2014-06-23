var $u = require('util')
var events = require('events')
var fs = require('fs')
var path = require('path')
var debug = require('debug')('directory-cache')
var DirectoryWatcher = require('directory-watcher')
var async = require('async')
var _ = require('lodash')

module.exports = DirectoryCache

/*
	creates a cache over a directory files and their content. cache updates itself using a DirectoryWatcher

	@param directory required, path to the directory we cache
	@param filter an optional parameter can be a function: function filter(file) { return file.indexOf('1') > -1 // will filter files with 1 in their names } or a regular expression
	
	@constructor
*/
$u.inherits(DirectoryCache, events.EventEmitter)
function DirectoryCache(directory, filter) {
	events.EventEmitter.call(this)

	this.count = 0 // used to dirty flag keys array created in getFiles() with lastCount
	this.lastCount = 0 
	
	this.enableJsonParsing()

	this.directory = directory

	this._pathJoin = _.partial(pathJoin, this.directory)

	this._joinStatReadAdd = async.seq(this._pathJoin, stat, maybeRead, _.bind(this._addFile, this))

	this._joinStatReadUpdate = async.seq(this._pathJoin, stat, maybeRead, _.bind(this._updateFile, this))

	this.filter = function(file) { return false }

	if (filter) {
		
		if ($u.isRegExp(filter)) {
			this.filter = function(file) {
				return !filter.test(file)
			}			
		} else {

			// assume function
			this.filter = filter
		}			
	} 
}

/*
	@param {String|Object} params DirectoryCaceh options
	@param {String} params.directory directory path
	@param {Regex} param.filter a regular expression to filter cached files
	@param {Function} callback when its all done :)
*/
DirectoryCache.create = function(params, callback) {
	var cache

	if (typeof(params) === 'string')
		cache = new DirectoryCache(params, undefined)
	else
		cache = new DirectoryCache(params.directory, params.filter)

	if (callback) 
		cache.init(callback)
	
	return cache
}

/*
	initialize the cache, this will create a new watcher if one wasn't attached first

	@param {Function} initCallback callback for when the initialization completes
*/
DirectoryCache.prototype.init = function(initCallback) {
	if (!initCallback)
		throw new Error('missing init callback')
	
	this.cache = {}	

	debug('creating directory cache for [%s]', this.directory)
	
	var done = _.partial(initSequenceDone, this, initCallback)

	if (!this._watcher) {
		var attachWatcher = _.bind(this.attachWatcher, this)
		var self = this

		DirectoryWatcher.create(this.directory, function(err, watcher) {
			if (err) return done(err)

			attachWatcher(watcher)

			mapFiles(self._joinStatReadAdd, watcher.files, done)
		})

	} else {

		mapFiles(this._joinStatReadAdd, this._watcher.files, done)
	}
}

/*
	stop this cache, freezing its current state	
*/
DirectoryCache.prototype.stop = function() {

	if (this.watcher) {
		
		this.watcher.removeAllListeners('add')
		this.watcher.removeAllListeners('change')
		this.watcher.removeAllListeners('delete')

		this.watcher.kill()		
	}
}

/*
	get an array of the names of all the files in the cached directory

	@returns {Array}
*/
DirectoryCache.prototype.getFilenames = function() {	
	return _.keys(this.cache)
}

/*	
	@param {String} file name of the file to delete
	@returns {String|Buffer} contents of the file from the cache or undefined if its not there
*/
DirectoryCache.prototype.getFile = function(file) {
	return this.cache[file]
}

/*
	disable automatic json parsing
*/
DirectoryCache.prototype.disableJsonParsing = function() {
	this.parseJson = false
}

/*
	enable automatic json parsing
*/
DirectoryCache.prototype.enableJsonParsing = function() {
	this.parseJson = true
}

/*
	attach a watcher to this cache, this is an optional method. init() will
	create a new watcher if attachWatcher() is never called

	@param {DirectoryWatcher} watcher a DirectoryWatcher instance (directory-watcher on npm)
*/
DirectoryCache.prototype.attachWatcher = function(watcher) {
	
	var deleteOne = _.bind(this._deleteFile, this)
	
	var self = this
	watcher.on('add', function (files) {
		mapFiles(self._joinStatReadAdd, files, maybeEmitError)	
	})

	watcher.on('change', function (files) {
		mapFiles(self._joinStatReadUpdate, files, maybeEmitError)	
	})

	watcher.on('delete', function(files) {
		_.map(files, deleteOne)
	})
	
	this._watcher = watcher
}

/*
	add a file to the cache,
	the file must reside in the cache directory (this is not enforced)

	@private
	@param {String} file name of the file
	@param {String|Buffer} data initial value of the file content to cache
	@param {fs.Stat} stat a stat object
	@param {Function} callback
*/
DirectoryCache.prototype._addFile = function(file, data, stat, callback) {

	debug('_addFile( %s, %s)', file, data)

	data = this._cacheFile(file, data)

	this.count++

	this.emit('add', file, data)

	callback(null)
}

/*
	update a file in the cache,
	the file must reside in the cache directory (this is not enforced)
	the file must already exist in the cache (enforced)

	@private
	@param {String} file name of the file
	@param {String|Buffer} data updated value of the file content to cache
	@param {fs.Stat} stat a stat object
	@param {Function} callback
*/
DirectoryCache.prototype._updateFile = function(file, data, stat, callback) {
	debug('_updateFile( %s, %s )', file, data)

	if (!file in this.cache) throw new Error('cannot update a new file, use _addFile() instead')

	data = this._cacheFile(file, data)

	this.emit('update', file, data)

	callback(null)
}

/*
	delete a file from the cache. Deletion of files that dont exist are ignored silently

	@private
	@param {String} file name of the file to delete
	@returns {String|Buffer} content of the deleted file
*/
DirectoryCache.prototype._deleteFile = function(file) {

	if (file in this.cache) {
		debug('deleting %s', file)
		var data = this.cache[file]
		delete this.cache[file]
		this.count--
		this.emit('delete', file, data)
		return data
	} else {
		debug('(almost) silently ignoring deletion of %s (not in cache)', file)
	}
}

/*
	caching implementation, used by _addFile and _updateFile

	@private
	@param {String} file the name of the file
	@param {String|Buffer} data data to cache
*/
DirectoryCache.prototype._cacheFile = function(file, data) {
	var json = this.parseJson && isJsonFile(file)

	var encoding = json ? undefined : 'utf8'

	if (json)
		data = JSON.parse(data)
	
	this.cache[file] = data	

	return data
}

function maybeEmitError(err) {
	if (err)
		this.emit('error', err)
}

/*
	used as a subtask in asyncs to do stuff on files

	@param {Function}
	@param {Array} files
	@param {Function} callback

	@private
*/
function mapFiles(operation, files, callback) {
	debug('mapFiles(...)')

	async.map(files, operation, callback)
}

/*
	path join for async flows
*/
function pathJoin(directory, file, callback) {
	debug('pathJoin(%s, %s)', directory, file)
	callback(null, path.join(directory, file), file)
}

/*
	
	@param {String} fullpath full path to a file
	@param {String} file basename
	@param {Function} callback

	@private
*/
function stat(fullpath, file, callback) {
	debug('stat(%s, %s)', fullpath, file)
	fs.stat(fullpath, function(err, stat) {
		if (err) return callback(err)

		callback(null, fullpath, file, stat)
	})
}

/*
	maybe read a file if indeed its a normal file

	@param {String} fullpath full path to a file
	@param {String} file basename
	@param {fs.Stat} stat an fs.Stat object
	@param {Function} callback

	@private
*/
function maybeRead(fullpath, file, stat, callback) {
	
	if (stat.isFile()) {
		fs.readFile(fullpath, function(err, content) {
			if (err) return callback(err)

			callback(null, file, content, stat)
		})
	} else {
		callback(null, file, undefined, stat)
	}
}

/*
	init help

	@private
*/
function initSequenceDone(cache, initCallback, err) {
	
	if (err) {
		debug('ERROR: %s', err.message)
		initCallback(err)			
	} else {
		debug('cache initialized successfully')
		initCallback(null, cache)
	}
}

/*
	checks if a file has a .json extension

	@param {String} filename the name of the file

	@private
*/
function isJsonFile(filename) {
	return filename.slice(-5).toLowerCase() === '.json'
}