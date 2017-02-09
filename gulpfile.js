/*!
 * Command line tools for Back2Front
 * 构建流程
 */

'use strict';

var path = require('path'),
	fs = require('fs'),
	gulp = require('gulp'),
	gulpFilter = require('gulp-filter'),
	gulpLEC = require('gulp-line-ending-corrector'),
	gulpModify = require('gulp-modify'),
	gulpCleanCSS = require('gulp-clean-css'),
	gulpUglify = require('gulp-uglify'),
	jsonFormat = require('json-format'),
	util = require('./lib/util'),
	depa = require('./depa'),
	combiner = require('./lib/asset-combiner'),
	minimist = require('minimist'),
	argvs = require('minimist')( process.argv.slice(2) ),
	config = JSON.parse(argvs.config);


// 返回文件匹配规则
function srcGlobs(type, rule) {
	return path.resolve(config.build_from[type], rule);
}

// 返回目标目录
function gulpDest(type) {
	return gulp.dest(config.build_to[type]);
}


var depaMap;
// 分析页面模板依赖
gulp.task('depa', function(callback) {
	depa(config.pjPath, null, config).then(function(result) {
		depaMap = result;
		callback();
	});
});


// 解析出可用的静态资源路径
// 使用第一个路径引用CSS、普通JS资源
// 使用第二个（或第一个）路径引用模块化JS资源
// 保留最后一个静态资源路径用于在CSS文件中引用资源以及在页面中引用内容资源
var urlPrefixes = (config.static_hosts || ['']).map(function(host) {
	var result = util.parseVars(config.static_url_prefix, {
		host: host,
		rev: config.rev
	});
	if (result[result.length - 1] !== '/') { result += '/'; }
	return result;
});


// 匹配纯文本文件的过滤器
function createPlainTextFilter() {
	return gulpFilter(function(file) {
		return [
			'html',
			'css',
			'js',
			'json',
			'txt',
			'md',
			'log',
			''
		].indexOf(
			path.extname(file.path).toLowerCase()
		) !== -1;
	}, {
		restore: true
	});
}


// 静态资源构建
gulp.task('build-assets', function() {
	var plainTextFilter = createPlainTextFilter();

	// 匹配CSS
	var cssFilter = gulpFilter(function(file) {
		return path.extname(file.path).toLowerCase() === '.css';
	}, {
		restore: true
	});
	// 匹配普通JS
	var jsFilter = gulpFilter(function(file) {
		return /\.raw\.js$/i.test(file.path);
	}, {
		restore: true
	});
	// 匹配模块化JS
	var modjsFilter = gulpFilter(function(file) {
		return path.extname(file.path).toLowerCase() === '.js' &&
			!/\.raw\.js$/i.test(file.path);
	}, {
		restore: true
	});
	// 匹配模块化配置
	var modjsConfigFilter = gulpFilter(function(file) {
		return path.basename(file.path) === 'bowl-config.raw.js';
	}, {
		restore: true
	});

	// 转换为资源引用路径
	function toAssetPath(file) {
		return JSON.stringify(
			util.normalizeSlash(
				path.relative(file.base, file.path)
			)
		);
	}

	// 把CSS文件中的相对路径转换为绝对路径(总是使用最后一个静态资源路径)
	var inCSSURLPrefix = urlPrefixes[urlPrefixes.length - 1];
	function cssRel2Root(file, fn) {
		return function(match, quot, origPath) {
			if ( util.isURL(origPath) ) {
				return match;
			} else {
				return fn(
					quot +
					inCSSURLPrefix + util.normalizeSlash(
						path.relative(
							file.base,
							path.resolve(path.dirname(file.path), origPath)
						)
					) +
					quot
				);
			}
		};
	}

	return gulp
		.src([
			srcGlobs('static', '**/*'),
			'!' + srcGlobs('static', '**/*.xtpl'),
			'!' + srcGlobs('static', '**/*.xtpl.js'),
			'!' + srcGlobs('static', '**/*.defined.js')
		])
		.pipe( plainTextFilter )
		.pipe( gulpLEC() )
		.pipe( plainTextFilter.restore )
		.pipe( modjsConfigFilter )
		.pipe( gulpModify({
            fileModifier: function(file, content) {
				// 替换加载器basePath的值
				return content.replace(
					/^(\s*basePath\s*:\s*)(["']).*?\2/m,
					function(match, $1) {
						return $1 + JSON.stringify(
							urlPrefixes[1] || urlPrefixes[0]
						);
					}
				)
			}
		}) )
		.pipe( modjsConfigFilter.restore )
		.pipe( jsFilter )
		.pipe( gulpUglify({
			mangle: { screw_ie8: false },
			compress: { screw_ie8: false },
			output: { screw_ie8: false }
		}) )
		.pipe( gulpModify({
            fileModifier: function(file, content) {
				return 'jsFiles[' + toAssetPath(file) + ']=' +
					'function(window) {' + content + '};';
			}
		}) )
		.pipe( jsFilter.restore )
		.pipe( modjsFilter )
		.pipe( gulpModify({
            fileModifier: function(file, content) {
				return 'define(' +
					toAssetPath(file) + ',' +
					'null,' +
					'function(require, exports, module) { "use strict";' +
						content +
					'}' +
				');';
			}
        }) )
		.pipe( gulpUglify({
			mangle: { screw_ie8: false },
			compress: { screw_ie8: false },
			output: { screw_ie8: false }
		}) )
		.pipe( modjsFilter.restore )
		.pipe( cssFilter )
		.pipe( gulpModify({
			// 相对路径转成绝对路径
            fileModifier: function(file, content) {
				return content
					.replace(/^\s*@import\s+.*$/m, '')
					.replace(
						/\burl\((['"]?)(.+?)\1\)/g,
						cssRel2Root(
							file,
							function(result) { return 'url(' + result + ')'; }
						)
					)
					.replace(
						/\bsrc=(['"]?)(.+?)\1/g,
						cssRel2Root(
							file,
							function(result) { return 'src=' + result; }
						)
					);
			}
        }) )
		.pipe( gulpCleanCSS({
			compatibility: 'ie8',
			aggressiveMerging: false
		}) )
		.pipe( gulpModify({
            fileModifier: function(file, content) {
				var result = 'cssFiles[' + toAssetPath(file) + ']=' +
					JSON.stringify(content) + ';';

				file.path = util.convertExtname(file.path);
				return result;
			}
		}) )
		.pipe( cssFilter.restore )
		.pipe( gulpDest('static') )
});


// 构建模板（转成模块化）
gulp.task('build-tpl', function() {
	return gulp
		.src( srcGlobs('static', '**/*.xtpl') )
		.pipe( gulpLEC() )
		.pipe(
			gulpModify({
            	fileModifier: function(file, content) {
					file.path = util.convertExtname(file.path);
					return 'define(' +
						JSON.stringify(
							util.normalizeSlash(
								path.relative(file.base, file.path)
							)
						 ) + ',' +
						'null,' +
						'function(require, exports, module) {' +
							'module.exports=' + JSON.stringify(content) +
						'}' +
					');';
				}
			})
		)
		.pipe( gulpDest('static') );
});


var assetMap;
// 资源合并
gulp.task('combine-assets', ['depa', 'build-tpl', 'build-assets'], function(callback) {
	assetMap = combiner.combine(
		depaMap,
		config.combine,
		config.standalone,
		config.build_to.static
	);
	callback();
});


// 复制其余文件到目标目录
gulp.task('copy-others', function() {
	var plainTextFilter = createPlainTextFilter();
	return gulp
		.src([
			srcGlobs('server', '**/*'),
			'!' + srcGlobs('server', 'node_modules/**'),
			'!' + srcGlobs('server', '**/*.defined.js'),
			'!' + srcGlobs('server', '**/*.xtpl.js'),
			'!' + srcGlobs('server', '**/*.log')
		])
		.pipe( plainTextFilter )
		.pipe( gulpLEC() )
		.pipe( plainTextFilter.restore )
		.pipe( gulpDest('server') );
});


gulp.task('default', ['combine-assets', 'copy-others'], function() {
	Object.keys(assetMap).forEach(function(tplRelPath) {
		var tplAssets = assetMap[tplRelPath];
		['headjs', 'css', 'js', 'modjs'].forEach(function(assetType, i) {
			if (!tplAssets[assetType]) { return; }
			tplAssets[assetType] = tplAssets[assetType].map(function(p) {
				if ( !util.isURL(p) ) {
					var urlPrefix;
					if (i === 3) { urlPrefix = urlPrefixes[1]; }
					urlPrefix = urlPrefix || urlPrefixes[0];
					p = urlPrefix + p;
				}
				return p;
			});
		});
	});

	// 保存最终的资源引用表
	fs.writeFileSync(
		path.join(config.build_to.server, 'asset-config.json'),
		jsonFormat({
			url_prefix: urlPrefixes.slice(-1)[0],
			map: assetMap
		}),
		'utf8'
	);
});