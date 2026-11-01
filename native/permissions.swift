// 권한 상태 확인/요청 헬퍼. 앱이 실행한 자식 프로세스라 권한은 Meeting Recorder 앱 기준으로 적용된다.
//   permissions status          → {"inputMonitoring":"…","systemAudio":"…","accessibility":"granted|denied"}
//   permissions request input   → 입력 모니터링 요청 (시스템 설정 목록에 앱이 추가됨)
//   permissions request audio   → 시스템 오디오 녹음 요청 (처음이면 시스템 대화상자 표시)
//   permissions request accessibility → 손쉬운 사용 요청 (받아쓰기 결과를 ⌘V로 붙여 넣기 위해)
//   permissions paste           → 지금 포커스된 앱에 ⌘V 입력
//   permissions frontapp        → {"name":"Slack","bundleId":"com.tinyspeck.slackmacgap"} (받아쓰기 통계용)
// 시스템 오디오 녹음 권한은 공개 API가 없어 TCC 비공개 함수를 dlopen으로 쓴다 (AudioCap 등과 동일).
import Cocoa

setvbuf(stdout, nil, _IOLBF, 0)

let tccService = "kTCCServiceAudioCapture" as CFString
let tcc = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)

typealias PreflightFn = @convention(c) (CFString, CFDictionary?) -> Int
typealias RequestFn = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void

func systemAudioStatus() -> String {
    guard let tcc, let sym = dlsym(tcc, "TCCAccessPreflight") else { return "unknown" }
    switch unsafeBitCast(sym, to: PreflightFn.self)(tccService, nil) {
    case 0: return "granted"
    case 1: return "denied"
    default: return "unknown" // 아직 묻지 않음
    }
}

func inputMonitoringStatus() -> String {
    CGPreflightListenEventAccess() ? "granted" : "denied"
}

func accessibilityStatus() -> String {
    CGPreflightPostEventAccess() ? "granted" : "denied"
}

func pressCommandV() -> Bool {
    guard CGPreflightPostEventAccess() else { return false }
    let source = CGEventSource(stateID: .combinedSessionState)
    // 사용자가 아직 누르고 있는 키(fn 등)가 붙여 넣기에 섞이지 않게 한다
    source?.setLocalEventsFilterDuringSuppressionState([.permitLocalMouseEvents, .permitSystemDefinedEvents], state: .eventSuppressionStateSuppressionInterval)
    let cmdKey: CGKeyCode = 55
    let vKey: CGKeyCode = 9 // ANSI V. 한글 입력 상태에서도 ⌘ 조합은 이 키코드로 동작한다
    let sequence: [(CGKeyCode, Bool)] = [(cmdKey, true), (vKey, true), (vKey, false), (cmdKey, false)]
    for (key, down) in sequence {
        let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)
        event?.flags = (key == vKey || down) ? .maskCommand : []
        event?.post(tap: .cghidEventTap)
        usleep(8000)
    }
    usleep(50000) // 이벤트가 전달되기 전에 프로세스가 끝나지 않게
    return true
}

let args = CommandLine.arguments.dropFirst()

switch (args.first, args.dropFirst().first) {
case ("status", _):
    print("{\"inputMonitoring\":\"\(inputMonitoringStatus())\",\"systemAudio\":\"\(systemAudioStatus())\",\"accessibility\":\"\(accessibilityStatus())\"}")

case ("request", "input"):
    print(CGRequestListenEventAccess() ? "granted" : "denied")

case ("request", "accessibility"):
    print(CGRequestPostEventAccess() ? "granted" : "denied")

case ("frontapp", _):
    let front = NSWorkspace.shared.frontmostApplication
    let info = ["name": front?.localizedName ?? "", "bundleId": front?.bundleIdentifier ?? ""]
    let data = try! JSONSerialization.data(withJSONObject: info)
    print(String(data: data, encoding: .utf8)!)

case ("paste", _):
    if pressCommandV() { print("ok") } else { print("error:permission"); exit(2) }

case ("request", "audio"):
    guard let tcc, let sym = dlsym(tcc, "TCCAccessRequest") else {
        print("unsupported")
        exit(1)
    }
    unsafeBitCast(sym, to: RequestFn.self)(tccService, nil) { granted in
        print(granted ? "granted" : "denied")
        exit(0)
    }
    RunLoop.main.run(until: Date().addingTimeInterval(120))
    print("timeout")

default:
    FileHandle.standardError.write("usage: permissions status | request input|audio|accessibility | paste | frontapp\n".data(using: .utf8)!)
    exit(64)
}
