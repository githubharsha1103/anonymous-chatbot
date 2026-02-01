"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEvents = loadEvents;
const glob_1 = require("glob");
const index_1 = require("../index");
const telegramErrorHandler_1 = require("./telegramErrorHandler");
function loadEvents() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const Files = yield (0, glob_1.glob)(`${process.cwd()}/dist/Events/**/*.js`);
            for (let file of Files) {
                // Ensure absolute path for require
                const absolutePath = require("path").resolve(file);
                const eventFile = require(absolutePath).default;
                const event = eventFile;
                if (event.disabled)
                    continue;
                const eventType = event.type;
                if (!eventType)
                    continue;
                try {
                    index_1.bot.on(eventType, (ctx) => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        try {
                            yield event.execute(ctx, index_1.bot);
                        }
                        catch (error) {
                            const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
                            (0, telegramErrorHandler_1.handleTelegramError)(index_1.bot, error, userId);
                        }
                    }));
                }
                catch (error) {
                    console.error(`[EventHandler] -`, error);
                }
            }
            console.info(`[INFO] - Events Loaded`);
        }
        catch (err) {
            console.error(`[EventHandler] -`, err);
        }
    });
}
