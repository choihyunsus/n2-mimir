# Soul host helpers

`SoulPlugin` provides callable `activate` and `digest` methods. Pass the distribution Soul Mimir database path, project and agent explicitly. Supply a stable `sessionId` for report replay.

`registerMimirTools` supplies five descriptors to a registration callback. The host implements handlers, authorization and lifecycle invocation. Distribution Soul 9.2 also has its own Mimir integration.

한국어 안내

호스트에서 직접 호출하는 부팅·종료 보조 함수와 도구 명세입니다. 호스트가 실제 핸들러, 권한 확인, 수명주기 호출을 연결해야 합니다. 동일한 보고를 다시 처리할 때는 같은 sessionId를 넘기세요.
