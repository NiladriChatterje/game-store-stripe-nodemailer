var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { workerData } from 'node:worker_threads';
import { Buffer } from 'node:buffer';
function structuringDataAccordingToSanitySchema(workerData) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { imagesBase64 } = workerData;
        const bufferArr = [];
        for (let i of imagesBase64)
            bufferArr.push(Buffer.from((_a = i.base64) === null || _a === void 0 ? void 0 : _a.split(',')[1], 'base64')); //spliting because we only need data and not what encoding type
    });
}
structuringDataAccordingToSanitySchema(workerData).then(resolved => {
});
