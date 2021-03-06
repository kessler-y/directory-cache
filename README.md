Directory Cache
================

A directory cache, built on top of [DirectoryWatcher](https://github.com/yanush/DirectoryWatcher). The cache reads all the files in a directory
and caches their content. When files are changed, added, deleted etc the cache will update and fire an event using the good old EventEmitter API.

### Install

```
	npm install directory-cache
```


### Example

```
var DirectoryCache = require('directory-cache');

var cache = DirectoryCache.create({
	directory: '/path/to/the/moon'
}/*, optionally supply a callback to automatically call .init */);

cache.on('add', function(files) {
	var content = cache.getFileContent(files[0]);
	// do something with content
});

cache.on('change', function(files) {
	// etc...
});

cache.on('delete', function(files) {
	// etc..
});

cache.on('error', function(err) {
	// waaaaaaaaah!
})

cache.init(function(err) {
	if (err) 
		return console.log('ahhhhhhhhhhhh!', err);

	var content = cache.getFileContent('moo.txt'); // returns the content of /path/to/the/moon/moo.txt

	var files = cache.getFiles(); // returns all the files in /path/to/the/moon

});

```

### using filters

```
// regular expression retains only json files

var DirectoryCache = require('directory-cache');

var cache = DirectoryCache.create({
	directory: '/path/to/the/moon',
	filter: /.*json/
});

// function filter that retains only json files

var cache2 = DirectoryCache.create({
	directory: '/path/to/the/moon',
	filter: function(file) { return file.slice(-5).toLowerCase() === '.json' }
});
```