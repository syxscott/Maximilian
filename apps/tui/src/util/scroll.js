// @ts-nocheck
import { MacOSScrollAccel } from "@opentui/core";
export class CustomSpeedScroll {
    speed;
    constructor(speed) {
        this.speed = speed;
    }
    tick(_now) {
        return this.speed;
    }
    reset() { }
}
export function getScrollAcceleration(tuiConfig) {
    if (tuiConfig?.scroll_acceleration?.enabled) {
        return new MacOSScrollAccel();
    }
    if (tuiConfig?.scroll_speed !== undefined) {
        return new CustomSpeedScroll(tuiConfig.scroll_speed);
    }
    return new CustomSpeedScroll(3);
}
