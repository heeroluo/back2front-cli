/*!
 * Command line interface tools for Back2Front
 * 工具函数
 */

'use strict';


/**
 * 输出错误信息并退出
 * @method errorExit
 * @param {String} msg 错误信息
 */
exports.errorExit = (msg) => {
	console.error(msg);
	process.exit(1);
};


/**
 * 格式化日期
 * @method formatDate
 * @param {Date} date 日期
 * @param {String} formation 日期格式
 * @return {String} 格式化后的日期字符串
 */
exports.formatDate = (date, formation) => {
	const values = {
		Y: date.getFullYear(),
		M: date.getMonth() + 1,
		D: date.getDate(),
		h: date.getHours(),
		m: date.getMinutes(),
		s: date.getSeconds()
	};

	return formation.replace(/Y+|M+|D+|h+|m+|s+/g, (match) => {
		let result = values[match[0]];
		if (match.length > 1 && result.toString().length !== match.length) {
			result = (
				(new Array(match.length)).join('0') + result
			).slice(-match.length);
		}
		return result;
	});
};


/**
 * 把指定字符串中的变量占位符({$name})替换成值
 * @method parseVars
 * @param {String} str 指定字符串
 * @param {Object} data 值映射表
 * @return {String} 替换后的字符串
 */
exports.parseVars = (str, data) => {
	return str.replace(/\{\$(\w+)\}/g, (match, $1) => {
		return data[$1] == null ? '' : data[$1];
	});
};


/**
 * 判断指定字符串是否URL
 * @method isURL
 * @param {String} str 指定字符串
 * @return {Boolean} 指定字符串是否URL
 */
exports.isURL = (str) => { return /^([a-z]+:)?\/\//i.test(str); };


/**
 * 判断指定字符串是否Base64编码数据
 * @method isBase64
 * @param {String} str 指定字符串
 * @return {Boolean} 指定字符串是否Base64编码数据
 */
exports.isBase64 = (str) => { return /^data:/i.test(str); };



// 用于匹配扩展名（不能直接用path.extname，因为存在多个后缀的情况，如.raw.js）
const reExtname = /((?:\.\w+)+)$/;


const extnameMap = {
	'.xtpl': '.xtpl.js',
	'.css': '.css.js',
	'.scss': '.scss.js',
	headjs: '.raw.js',
	js: '.raw.js',
	css: '.css.js',
	modjs: '.js'
};
/**
 * 替换路径中的扩展名为资源最终扩展名
 * @method convertExtname
 * @param {String} filePath 文件路径
 * @param {String} [fileType] 文件类型
 * @return {String} 替换后的文件路径
 */
exports.convertExtname = (filePath, fileType) => {
	if (reExtname.test(filePath)) {
		filePath = filePath.replace(reExtname, (extname) => {
			return extnameMap[fileType || extname] || extname;
		});
	} else {
		filePath += extnameMap[fileType];
	}
	return filePath;
};


const reversedExtnameMap = {
	'.xtpl.js': '.xtpl',
	'.scss.js': '.scss',
	'.css.js': '.css'
};
exports.revertExtname = (filePath) => {
	if (reExtname.test(filePath)) {
		filePath = filePath.replace(reExtname, (extname) => {
			return reversedExtnameMap[extname] || extname;
		});
	}
	return filePath;
};


/**
 * 替换指定字符串中的“\”为“/”
 * @method normalizeSlash
 * @param {String} str 指定字符串
 * @return {String} 替换后的字符串
 */
exports.normalizeSlash = (str) => { return str.replace(/\\/g, '/'); };


const crypto = require('crypto');
/**
 * 计算指定字符串的MD5值
 * @method calcMd5
 * @param {String} str 指定字符串
 * @param {Number} [length] 如果为大于0的数字，则截取特定长度的MD5值
 * @return {String} 计算结果
 */
exports.calcMd5 = (str, length) => {
	let md5 = crypto.createHash('md5');
	md5.update(str);

	let result = md5.digest('hex');
	if (length) { result = result.substr(0, length); }
	return result;
};


const fs = require('fs');
const fileCache = { };
/**
 * 读取文件
 * @method readFile
 * @param {String} filePath 文件路径
 * @param {Boolean} [cache=false] 是否缓存文件内容
 * @return {String} 文件内容
 */
exports.readFile = (filePath, cache) => {
	let fileContent = fileCache[filePath];
	if (fileContent && cache !== false) { return fileContent; }

	fileContent = fs.readFileSync(filePath, 'utf8');
	if (cache) {
		fileCache[filePath] = fileContent;
	} else {
		delete fileCache[filePath];
	}

	return fileContent;
};