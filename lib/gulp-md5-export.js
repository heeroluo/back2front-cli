/*!
 * Command line interface tools for Back2Front
 * Gulp插件 - 文件名添加MD5戳，并输出映射关系
 */

'use strict';

const path = require('path');
const through = require('through2');
const util = require('./util');


// 获取相对路径，用于输出到地址映射
function getPath(file) {
	return file.base ? path.relative(file.base, file.path) : file.path;
}


module.exports = function(options) {
	options = options || { };
	options.separator = options.separator || '.';
	options.size = options.size || 10;

	return through.obj((file, enc, cb) => {
		if (file.isBuffer()) {
			let md5Hash = util.calcMd5(file.contents, options.size);
			let filename = path.basename(file.path);
			let srcPath = getPath(file);

			let dirname;
			if (file.path[0] == '.') {
				dirname = path.join(file.base, file.path);
			} else {
				dirname = file.path;
			}
			dirname = path.dirname(dirname);

			filename = filename.split('.').map((item, i, arr) => {
				return i == arr.length - 2 ?
					item + options.separator + md5Hash :
					item;
			}).join('.');

			file.path = path.join(dirname, filename);

			if (options.exportMap) {
				// 输出文件地址映射
				options.exportMap(
					srcPath.replace(/\\/g, '/'),
					getPath(file).replace(/\\/g, '/')
				);
			}
		}

		cb(null, file);
	});
};