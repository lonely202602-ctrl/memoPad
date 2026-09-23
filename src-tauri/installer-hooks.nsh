; 卸载时清理开机自启注册表项（用户数据 %APPDATA%\memoPad 保留不清除）
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "memoPad"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "memopad"
!macroend
