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
	@param params {Variant} directory path as string or { directory: '', filter: regex } object
	@param callback {Function} when its all done :)
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
	initialize the cache

	@param initCallback {Function} callback for when the initialization completes
*/
DirectoryCache.prototype.init = function(initCallback) {
	if (!initCallback)
		throw new Error('missing init callback')
	
	this.cache = {}	

	debug('creating directory cache for [%s]', this.directory)
	
	var initSequence = [		
		_.bind(fs.readdir, fs, this.directory),
		_.bind(readFiles, null, this.directory),
		_.bind(addFiles, this)
	]

	if (!this._watcher) {
		initSequence.push(_.bind(DirectoryWatcher.create, null, this.directory))
		initSequence.push(_.bind(this.attachWatcher, this))
	}

	async.waterfall(initSequence, _.bind(initSequenceDone, this, initCallback))	
}

function initSequenceDone(initCallback, err) {
	
	if (err) {
		debug('ERROR: %s', err.message)
		initCallback(err)			
	} else {
		debug('cache initialized successfully')
		initCallback(null, this)
	}
}

/*
	attach a watcher to this cache, this is an optional method. init() will
	create a new watcher attachWatcher() is never called

	@param watcher {DirectoryWatcher} a DirectoryWatcher instance (directory-watcher on npm)
	@param _callback {Function} private api
*/
DirectoryCache.prototype.attachWatcher = function(watcher, _callback) {
	var read = _.bind(readFiles, null, this.directory)	
	var update = _.bind(updateFiles, this)
	var add = _.bind(addFiles, this)
	var deleteOne = _.bind(this.deleteFile, this)
	var handleError = _.bind(maybeEmitError, this)

	watcher.on('add', function (files) {	
		async.waterfall([_.bind(read, null, files), add], handleError)
	})

	watcher.on('change', function (files) {
		async.waterfall([_.bind(read, null, files), update], handleError)
	})

	watcher.on('delete', function(files) {
		_.map(files, deleteOne)
	})
	
	this._watcher = watcher

	if (_callback)
		_callback(null)
}

DirectoryCache.prototype.getFilenames = function() {	
	return _.keys(this.cache)
}

DirectoryCache.prototype.stop = function() {
	if (this.watcher) {
		this.watcher.kill()		
	} 
}

DirectoryCache.prototype.addFile = function(file, data) {	
	debug('adding %s', file)

	data = this._cacheFile(file, data)

	this.count++

	this.emit('add', file, data)
}

DirectoryCache.prototype.updateFile = function(file, data) {
	debug('updating %s', file)

	data = this._cacheFile(file, data)

	this.emit('update', file, data)
}

DirectoryCache.prototype.deleteFile = function(file) {
	debug('deleting %s', file)
	var data = this.cache[file]
	delete this.cache[file]
	this.count--
	this.emit('delete', file, data)
}

DirectoryCache.prototype.getFile = function(file) {
	return this.cache[file]
}

DirectoryCache.prototype.disableJsonParsing = function() {
	this.parseJson = false
}

DirectoryCache.prototype.enableJsonParsing = function() {
	this.parseJson = true
}

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

function readFiles(directory, files, callback) {
	debug('reading files')

	var functors = {}

	for (var i = 0; i < files.length; i++) 
		functors[files[i]] = _.bind(fs.readFile, fs, path.join(directory, files[i]))

	async.parallel(functors, callback)
}

function addFiles(files, callback) {
	debug('adding files')
	
	for (var file in files) {
		var data = files[file]

		this.addFile(file, data)
	}

	if (callback)
		callback(null)
}

function updateFiles(files, callback) {
	debug('updating files')
	
	for (var file in files) {
		var data = files[file]

		this.updateFile(file, data)
	}

	if (callback)
		callback(null)
}

function isJsonFile(filename) {
	return filename.slice(-5).toLowerCase() === '.json'
}