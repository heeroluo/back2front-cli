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
	config = global.buildingConfig;


// 返回文件匹配规则
function srcGlobs(type, rule) {
	return path.resolve(config.build_from[type], rule);
}

// 返回目标目录
function gulpDest(type) {
	return gulp.dest(config.build_to[type]);
}


var depaResult;
// 分析页面模板依赖
gulp.task('depa', function(callback) {
	depa(config.pjPath, null, buildingConfig).then(function(result) {
		depaResult = result;
		callback();
	});
});


// 静态资源构建
gulp.task('build-assets', function() {
	// 匹配CSS
	var cssFilter = gulpFilter(function(file) {
		return path.extname(file.path).toLowerCase() === '.css';
	}, {
		restore: true
	});
	// 匹配普通JS
	var jsFilter = gulpFilter(function(file) {
		return path.extname(file.path).toLowerCase() === '.js' &&
			!/\.mod\.js$/i.test(file.path);
	}, {
		restore: true
	});
	// 匹配模块化JS
	var modjsFilter = gulpFilter(function(file) {
		return /\.mod\.js$/i.test(file.path);
	}, {
		restore: true
	});
	// 匹配模块化配置
	var modjsConfigFilter = gulpFilter(function(file) {
		return path.basename(file.path) === 'bowl-config.js';
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

	// 把CSS文件中的相对路径转换为绝对路径
	// 总是使用静态资源域名的第二个（或第一个）
	var cssRefHost = config.static_hosts.slice(-1)[0];
	function cssRel2Root(file, fn) {
		return function(match, quot, origPath) {
			if ( util.isURL(origPath) ) {
				return match;
			} else {
				return fn(
					quot +
					util.parseVars(config.static_url, {
						host: cssRefHost,
						rev: config.rev,
						path: util.normalizeSlash(
							path.relative(
								file.base,
								path.resolve(path.dirname(file.path), origPath)
							)
						)
					}) +
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
			'!' + srcGlobs('static', '**/*.mod.defined.js')
		])
		.pipe( gulpLEC() )
		.pipe( modjsConfigFilter )
		.pipe( gulpModify({
            fileModifier: function(file, content) {
				// 替换加载器basePath的值
				return content.replace(
					/^(\s*basePath\s*:\s*)(["']).*?\2/m,
					function(match, $1) {
						return $1 + JSON.stringify(
							util.parseVars(config.static_url, {
								// 总是使用静态资源域名的最后一个
								host: config.static_hosts.slice(-1)[0],
								rev: config.rev,
								path: ''
							})
						);
					}
				)
			}
		}) )
		.pipe( modjsConfigFilter.restore )
		.pipe( jsFilter )
		.pipe( gulpUglify() )
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
		.pipe( gulpUglify() )
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
			compatibility: 'ie7',
			aggressiveMerging: false
		}) )
		.pipe( gulpModify({
            fileModifier: function(file, content) {
				file.path = util.convertExtname(file.path);
				return 'cssFiles[' + toAssetPath(file) + ']=' +
					JSON.stringify(content) + ';';
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
		depaResult,
		config.combine,
		config.standalone,
		config.build_to.static
	);
	callback();
});


// 复制其余文件到目标目录
gulp.task('copy-others', function() {
	var noBinFilter = gulpFilter(function(file) {
		// 过滤出非二进制
		return !/\.(?:ico|jpg|png|gif|swf)$/i.test(file.path);
	}, { restore: true });

	return gulp
		.src([
			srcGlobs('server', '**/*'),
			'!' + srcGlobs('server', 'node_modules/**'),
			'!' + srcGlobs('server', '**/*.mod.defined.js'),
			'!' + srcGlobs('server', '**/*.xtpl.js'),
			'!' + srcGlobs('server', '**/*.log')
		])
		.pipe( noBinFilter )
		.pipe( gulpLEC() )
		.pipe( noBinFilter.restore )
		.pipe( gulpDest('server') );
});


gulp.task('default', ['combine-assets', 'copy-others'], function() {
	var allURLPrefixes = config.static_hosts.map(function(host) {
		return util.parseVars(config.static_url, {
			host: host,
			rev: config.rev,
			path: ''
		});
	});

	// 使用“域名总数-1”个静态资源域名引用CSS、JS资源
	// 保留一个用于加载CSS文件引用的资源，以及页面中插入的图片等资源
	var assetURLPrefixes = allURLPrefixes.slice(0, allURLPrefixes.length - 1);

	Object.keys(assetMap).forEach(function(tplRelPath) {
		var tplAssets = assetMap[tplRelPath], counter = 0, i = -1;

		Object.keys(tplAssets).forEach(function(assetType) {
			tplAssets[assetType] = tplAssets[assetType].map(
				function(assetPath) {
					// 考虑浏览器并发数为4的情况，每4个资源换一次域名
					if (counter % 4 === 0) {
						i++;
						if (i >= assetURLPrefixes.length) { i = 0; }
					}
					counter++;
					return assetURLPrefixes[i] + assetPath;
				}
			);
		});
	});

	// 保存最终的资源引用表
	fs.writeFileSync(
		path.join(config.build_to.server, 'assets.json'),
		jsonFormat({
			url_prefix: allURLPrefixes.slice(-1)[0],
			map: assetMap
		}),
		'utf8'
	);
});