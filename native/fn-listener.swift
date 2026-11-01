// fn(🌐) 키 이벤트를 감지해 stdout으로 한 줄씩 내보내는 헬퍼.
// 출력: "ready" | "down" | "up" | "chord" (fn을 누른 채 다른 키를 눌렀다 뗀 경우) | "error:permission"
// Electron globalShortcut은 fn 키를 잡을 수 없어서 CGEventTap(listen-only)을 쓴다.
import Cocoa

setvbuf(stdout, nil, _IOLBF, 0)

let kVKFunction: Int64 = 63
var fnDown = false
var chorded = false
var tap: CFMachPort?

func emit(_ line: String) { print(line) }

if !CGPreflightListenEventAccess() {
    CGRequestListenEventAccess()
    emit("error:permission")
    exit(2)
}

let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue) | CGEventMask(1 << CGEventType.keyDown.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .keyDown:
        if fnDown { chorded = true }
    case .flagsChanged:
        guard event.getIntegerValueField(.keyboardEventKeycode) == kVKFunction else { break }
        let isDown = event.flags.contains(.maskSecondaryFn)
        if isDown && !fnDown {
            fnDown = true
            chorded = false
            emit("down")
        } else if !isDown && fnDown {
            fnDown = false
            emit(chorded ? "chord" : "up")
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
)

guard let tap else {
    emit("error:permission")
    exit(2)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit("ready")
CFRunLoopRun()
