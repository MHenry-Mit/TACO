﻿/**
﻿ *******************************************************
﻿ *                                                     *
﻿ *   Copyright (C) Microsoft. All rights reserved.     *
﻿ *                                                     *
﻿ *******************************************************
﻿ */

/// <reference path="../typings/mkdirp.d.ts"/>
/// <reference path="../typings/ncp.d.ts"/>
/// <reference path="../typings/node.d.ts" />
/// <reference path="../typings/nopt.d.ts" />
/// <reference path="../typings/Q.d.ts" />
/// <reference path="../typings/rimraf.d.ts"/>

"use strict";
import child_process = require ("child_process");
import crypto = require ("crypto");
import fs = require ("fs");
import mkdirp = require ("mkdirp");
import ncp = require ("ncp");
import os = require ("os");
import path = require ("path");
import Q = require ("q");
import rimraf = require ("rimraf");

import tacoErrorCodes = require ("./tacoErrorCodes");
import errorHelper = require ("./tacoErrorHelper");

import TacoErrorCodes = tacoErrorCodes.TacoErrorCode;

module TacoUtility {
    export class UtilHelper {
        private static InvalidAppNameChars: { [key: string]: string } = {
            34: "\"",
            36: "$",
            38: "&",
            39: "/",
            60: "<",
            92: "\\"
        };

        public static get tacoHome(): string {
            if (process.env["TACO_HOME"]) {
                return process.env["TACO_HOME"];
            }

            switch (os.platform()) {
                case "win32":
                    return path.join(process.env["APPDATA"], "taco_home");
                case "darwin":
                case "linux":
                    return path.join(process.env["HOME"], ".taco_home");
                default:
                    throw new Error("UnexpectedPlatform");
            };
        }

        /**
         * Read the contents of a file, stripping out any byte order markers
         *
         * @param {string} filename The file to read
         * @param {string} encoding What encoding to read the file as, defaulting to utf-8
         * @return {string} The contents of the file, excluding byte order markers.
         */
        public static readFileContentsSync(filename: string, encoding?: string): string {
            var contents = fs.readFileSync(filename, (encoding || "utf-8"));
            if (contents) {
                contents = contents.replace(/^\uFEFF/, ""); // Windows is the BOM
            }

            return contents;
        }

        /**
         * Asynchronously copy a file
         * 
         * @param {string} from Location to copy from
         * @param {string} to Location to copy to
         * @param {string} encoding Encoding to use when reading and writing files
         * @returns {Q.Promise} A promise which is fulfilled when the file finishes copying, and is rejected on any error condition.
         */
        public static copyFile(from: string, to: string, encoding?: string): Q.Promise<any> {
            var deferred = Q.defer();
            var newFile = fs.createWriteStream(to, { encoding: encoding });
            var oldFile = fs.createReadStream(from, { encoding: encoding });
            newFile.on("finish", function (): void {
                deferred.resolve({});
            });
            newFile.on("error", function (e: Error): void {
                deferred.reject(errorHelper.wrap(TacoErrorCodes.FailedFileRead, e, to));
            });
            oldFile.on("error", function (e: Error): void {
                deferred.reject(errorHelper.wrap(TacoErrorCodes.FailedFileWrite, e, from));
            });
            oldFile.pipe(newFile);
            return deferred.promise;
        }

        /**
         * Recursively copy 'source' to 'target' asynchronously
         *
         * @param {string} source Location to copy from
         * @param {string} target Location to copy to
         * @returns {Q.Promise} A promise which is fulfilled when the copy completes, and is rejected on error
         */
        public static copyRecursive(source: string, target: string, options?: any): Q.Promise<any> {
            var deferred = Q.defer();

            options = options ? options : {};

            ncp.ncp(source, target, options, function (error: any): void {
                if (error) {
                    deferred.reject(errorHelper.wrap(TacoErrorCodes.FailedRecursiveCopy, error, source, target));
                } else {
                    deferred.resolve({});
                }
            });

            return deferred.promise;
        }

        /**
         * Synchronously create a directory if it does not exist
         * 
         * @param {string} dir The directory to create
         *
         * @returns {boolean} If the directory needed to be created then returns true, otherwise returns false. If the directory could not be created, then throws an exception.
         */
        public static createDirectoryIfNecessary(dir: string): boolean {
            if (!fs.existsSync(dir)) {
                try {
                    mkdirp.sync(dir);
                    return true;
                } catch (err) {
                    // if multiple msbuild processes are running on a first time solution build, another one might have created the basedir. check again.
                    if (!fs.existsSync(dir)) {
                        throw err;
                    }
                }
            }

            return false;
        }

        /**
         * Determine whether a string contains characters forbidden in a Cordova display name
         *
         * @param {string} str The string to check
         * @return {boolean} true if the display name is acceptable, false otherwise
         */
        public static isValidCordovaAppName(str: string): boolean {
            for (var i = 0, n = str.length; i < n; i++) {
                var code = str.charCodeAt(i);
                if (code < 32 || UtilHelper.InvalidAppNameChars[code]) {
                    return false;
                }
            }

            return true;
        }

        /**
         * Return a list of characters which must not appear in an app's display name
         *
         * @return {string[]} The forbidden characters
         */
        public static invalidAppNameCharacters(): string[] {
            return Object.keys(UtilHelper.InvalidAppNameChars).map(function (c: string): string {
                return UtilHelper.InvalidAppNameChars[c];
            });
        }

        /**
         * Surround a string with double quotes if it contains spaces.
         *
         * @param {string} input The string to make safer
         * @returns {string} Either the input string unchanged, or the input string surrounded by double quotes and with any initial double quotes escaped
         */
        public static quotesAroundIfNecessary(input: string): string {
            return (input.indexOf(" ") > -1) ? "\"" + input.replace(/"/g, "\\\"") + "\"" : input;
        }

        /**
         * Call exec and log the child process' stdout and stderr to stdout on failure
         */
        public static loggedExec(command: string, options: NodeJSChildProcess.IExecOptions, callback: (error: Error, stdout: Buffer, stderr: Buffer) => void): child_process.ChildProcess {
            return child_process.exec(command, options, function (error: Error, stdout: Buffer, stderr: Buffer): void {
                if (error) {
                    console.error(command);
                    console.error(stdout);
                    console.error(stderr);
                }

                callback(error, stdout, stderr);
            });
        }

        /**
         * Returns a new options dictionary that contains options from the specified dictionary minus the options whose names are in the specified exclusion list
         *
         * @param {[option: string]: any} Options dictionary to be cleansed
         * @returns {string[]} Options to exclude from the specified options dictionary
         *
         * @return {[option: string]: any } A new options dictionary containing the cleansed options
         */
        public static cleanseOptions(options: { [option: string]: any }, exclude: string[]): { [option: string]: any } {
            var cleansed: { [option: string]: any } = {};
            
            for (var opt in options) {
                if (!exclude || exclude.indexOf(opt) < 0) {
                    cleansed[opt] = options[opt];
                }
            }

            return cleansed;
        }

        /**
         * Validates the given path, ensuring all segments are valid directory / file names
         *
         * @param {string} pathToTest The path to validate
         *
         * @return {boolean} A boolean set to true if the path is valid, false if not
         */
        public static isPathValid(pathToTest: string): boolean {
            // Set up test folder
            var tmpDir: string = os.tmpdir();
            var testDir: string = crypto.pseudoRandomBytes(20).toString("hex");

            while (fs.existsSync(path.join(tmpDir, testDir))) {
                testDir = crypto.pseudoRandomBytes(20).toString("hex");
            }

            // Test each segment of the path
            var currentPath: string = path.join(tmpDir, testDir);
            var hasInvalidSegments: boolean;

            fs.mkdirSync(currentPath);
            hasInvalidSegments = pathToTest.split(path.sep).some(function (segment: string, index: number): boolean {
                // Don't test the very first segment if it is a drive letter (windows only)
                if (index === 0 && os.platform() === "win32" && /^[a-zA-Z]:$/.test(segment)) {
                    return false;
                }

                try {
                    var nextPath: string = path.join(currentPath, segment);

                    fs.mkdirSync(nextPath);
                    currentPath = nextPath;
                } catch (err) {
                    // If we catch an ENOENT, it means the segment is an invalid filename. For any other exception, we can't be sure, so we try to be permissive.
                    if (err.code === "ENOENT") {
                        return true;
                    }
                }

                return false;
            });

            // Attempt to delete our test folders, but don't throw if it doesn't work
            rimraf(currentPath, function (error: Error): void { });

            // Return the result
            return !hasInvalidSegments;
        }
    }
}

export = TacoUtility;
