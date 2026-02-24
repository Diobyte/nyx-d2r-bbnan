#include <Windows.h>
//
#include <TlHelp32.h>

#include <atomic>
#include <cstdio>
#include <filesystem>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <vector>

constexpr auto kTargetName = "D2R.exe";
constexpr auto kModuleName = "nyx.d2r.dll";
// Each D2R instance gets its own pipe: dolos_log_<pid>
constexpr auto kPipeNamePrefix = "\\\\.\\pipe\\dolos_log_";

static std::atomic<bool> g_running{true};

// Returns the PIDs of all running instances of a given executable name.
static std::vector<DWORD> FindAllProcessesByName(const char* name) {
  std::vector<DWORD> pids;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return pids;

  PROCESSENTRY32 pe32{sizeof(PROCESSENTRY32)};
  if (Process32First(snapshot, &pe32)) {
    do {
      if (stricmp(name, pe32.szExeFile) == 0) {
        pids.push_back(pe32.th32ProcessID);
      }
    } while (Process32Next(snapshot, &pe32));
  }

  CloseHandle(snapshot);
  return pids;
}

// Returns true if a named module is already loaded inside the target process.
static bool IsModuleLoaded(DWORD pid, const char* module_name) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
  if (snapshot == INVALID_HANDLE_VALUE) return false;

  MODULEENTRY32 me32{sizeof(MODULEENTRY32)};
  bool found = false;
  if (Module32First(snapshot, &me32)) {
    do {
      if (stricmp(module_name, me32.szModule) == 0) {
        found = true;
        break;
      }
    } while (Module32Next(snapshot, &me32));
  }

  CloseHandle(snapshot);
  return found;
}

// Injects kModuleName into the process identified by pid.
// Returns true on success.
static bool InjectDll(DWORD pid, const std::string& dll_path) {
  HANDLE process = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
  if (!process || process == INVALID_HANDLE_VALUE) {
    fprintf(stderr, "[PID %lu] Failed to open process: %lu\n", pid, GetLastError());
    return false;
  }

  bool success = false;
  LPVOID path_addr = nullptr;
  HANDLE remote_thread = nullptr;

  path_addr = VirtualAllocEx(process, nullptr, 0x200, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (!path_addr) {
    fprintf(stderr, "[PID %lu] VirtualAllocEx failed: %lu\n", pid, GetLastError());
    goto done;
  }

  if (!WriteProcessMemory(process, path_addr, dll_path.c_str(), dll_path.size() + 1, nullptr)) {
    fprintf(stderr, "[PID %lu] WriteProcessMemory failed: %lu\n", pid, GetLastError());
    goto done;
  }

  {
    HMODULE k32 = GetModuleHandleA("kernel32.dll");
    FARPROC load_library = GetProcAddress(k32, "LoadLibraryA");
    remote_thread = CreateRemoteThread(
        process, nullptr, 0,
        reinterpret_cast<LPTHREAD_START_ROUTINE>(load_library),
        path_addr, 0, nullptr);
    if (!remote_thread) {
      fprintf(stderr, "[PID %lu] CreateRemoteThread failed: %lu\n", pid, GetLastError());
      goto done;
    }
    WaitForSingleObject(remote_thread, INFINITE);
    fprintf(stdout, "[PID %lu] DLL injected\n", pid);
    success = true;
  }

done:
  if (remote_thread) CloseHandle(remote_thread);
  if (path_addr) VirtualFreeEx(process, path_addr, 0, MEM_RELEASE);
  CloseHandle(process);
  return success;
}

// Returns the PID of the D2R instance that currently owns the foreground window,
// or 0 if no D2R window is in the foreground.
static DWORD GetForegroundD2rPid() {
  HWND fg = GetForegroundWindow();
  if (!fg) return 0;
  DWORD pid = 0;
  GetWindowThreadProcessId(fg, &pid);
  if (!pid) return 0;

  HANDLE ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!ph || ph == INVALID_HANDLE_VALUE) return 0;

  char exe_path[MAX_PATH]{};
  DWORD size = MAX_PATH;
  bool is_d2r = false;
  if (QueryFullProcessImageNameA(ph, 0, exe_path, &size)) {
    const char* last_sep = strrchr(exe_path, '\\');
    const char* fname = last_sep ? last_sep + 1 : exe_path;
    if (stricmp(fname, kTargetName) == 0) {
      is_d2r = true;
    }
  }
  CloseHandle(ph);
  return is_d2r ? pid : 0;
}

// Returns true if a process is still alive.
static bool IsProcessAlive(DWORD pid) {
  HANDLE ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!ph || ph == INVALID_HANDLE_VALUE) return false;
  DWORD code = 0;
  bool alive = GetExitCodeProcess(ph, &code) && code == STILL_ACTIVE;
  CloseHandle(ph);
  return alive;
}

// Returns the base address of module_name loaded inside pid, or nullptr.
static HMODULE GetRemoteModuleBase(DWORD pid, const char* module_name) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
  if (snapshot == INVALID_HANDLE_VALUE) return nullptr;

  MODULEENTRY32 me32{sizeof(MODULEENTRY32)};
  HMODULE base = nullptr;
  if (Module32First(snapshot, &me32)) {
    do {
      if (stricmp(module_name, me32.szModule) == 0) {
        base = me32.hModule;
        break;
      }
    } while (Module32Next(snapshot, &me32));
  }
  CloseHandle(snapshot);
  return base;
}

// Calls FreeLibrary(module_name) inside pid via a remote thread.
static bool UnloadDll(DWORD pid, const char* module_name) {
  HMODULE remote_base = GetRemoteModuleBase(pid, module_name);
  if (!remote_base) {
    fprintf(stdout, "[PID %lu] Module not found in process, nothing to unload\n", pid);
    return true;
  }

  HANDLE process = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
  if (!process || process == INVALID_HANDLE_VALUE) {
    fprintf(stderr, "[PID %lu] Failed to open process for unload: %lu\n", pid, GetLastError());
    return false;
  }

  FARPROC free_library = GetProcAddress(GetModuleHandleA("kernel32.dll"), "FreeLibrary");
  HANDLE remote_thread = CreateRemoteThread(
      process, nullptr, 0,
      reinterpret_cast<LPTHREAD_START_ROUTINE>(free_library),
      remote_base, 0, nullptr);

  bool success = false;
  if (remote_thread) {
    WaitForSingleObject(remote_thread, INFINITE);
    CloseHandle(remote_thread);
    fprintf(stdout, "[PID %lu] DLL unloaded\n", pid);
    success = true;
  } else {
    fprintf(stderr, "[PID %lu] FreeLibrary remote thread failed: %lu\n", pid, GetLastError());
  }
  CloseHandle(process);
  return success;
}

// Pipe server for one D2R instance. Listens on dolos_log_<pid>.
class InstancePipeServer {
 public:
  explicit InstancePipeServer(DWORD pid)
      : pid_(pid),
        pipe_name_(kPipeNamePrefix + std::to_string(pid)),
        pipe_(INVALID_HANDLE_VALUE) {}

  ~InstancePipeServer() { Stop(); }

  InstancePipeServer(const InstancePipeServer&) = delete;
  InstancePipeServer& operator=(const InstancePipeServer&) = delete;

  DWORD pid() const { return pid_; }

  bool Start() {
    if (!CreatePipe_()) return false;
    running_ = true;
    server_thread_ = std::thread(&InstancePipeServer::ServerLoop, this);
    fprintf(stdout, "[PID %lu] Pipe server started on %s\n", pid_, pipe_name_.c_str());
    return true;
  }

  // Send a short command string to the DLL (e.g. "show" or "hide").
  // Safe to call from any thread. No-op if the DLL client is not yet connected.
  void SendCommand(const char* cmd) {
    if (!client_connected_ || pipe_ == INVALID_HANDLE_VALUE) return;
    DWORD len = static_cast<DWORD>(strlen(cmd));
    OVERLAPPED ov{};
    ov.hEvent = CreateEvent(nullptr, TRUE, FALSE, nullptr);
    if (!ov.hEvent) return;
    BOOL ok = WriteFile(pipe_, cmd, len, nullptr, &ov);
    if (!ok && GetLastError() == ERROR_IO_PENDING) {
      WaitForSingleObject(ov.hEvent, 1000);
    }
    CloseHandle(ov.hEvent);
  }

  void Stop() {
    running_ = false;
    if (pipe_ != INVALID_HANDLE_VALUE) {
      CancelIoEx(pipe_, nullptr);
      DisconnectNamedPipe(pipe_);
      CloseHandle(pipe_);
      pipe_ = INVALID_HANDLE_VALUE;
    }
    if (server_thread_.joinable()) {
      server_thread_.join();
    }
  }

 private:
  bool CreatePipe_() {
    pipe_ = CreateNamedPipeA(
        pipe_name_.c_str(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        1, 4096, 4096, 0, nullptr);
    if (pipe_ == INVALID_HANDLE_VALUE) {
      fprintf(stderr, "[PID %lu] CreateNamedPipe failed for '%s': %lu\n",
              pid_, pipe_name_.c_str(), GetLastError());
      return false;
    }
    return true;
  }

  void ServerLoop() {
    char buffer[4096];

    while (running_) {
      // Wait for the DLL to connect.
      OVERLAPPED ov{};
      ov.hEvent = CreateEvent(nullptr, TRUE, FALSE, nullptr);

      BOOL ok = ConnectNamedPipe(pipe_, &ov);
      if (!ok) {
        DWORD err = GetLastError();
        if (err == ERROR_IO_PENDING) {
          while (running_) {
            if (WaitForSingleObject(ov.hEvent, 500) == WAIT_OBJECT_0) {
              ok = TRUE;
              break;
            }
          }
        } else if (err == ERROR_PIPE_CONNECTED) {
          ok = TRUE;
        }
      }
      CloseHandle(ov.hEvent);
      if (!running_) break;

      if (ok) {
        fprintf(stdout, "[PID %lu] Client connected\n", pid_);
        client_connected_ = true;

        while (running_) {
          DWORD bytes_read = 0;
          OVERLAPPED rov{};
          rov.hEvent = CreateEvent(nullptr, TRUE, FALSE, nullptr);

          BOOL read_ok = ReadFile(pipe_, buffer, sizeof(buffer) - 1, &bytes_read, &rov);
          if (!read_ok) {
            DWORD err = GetLastError();
            if (err == ERROR_IO_PENDING) {
              while (running_) {
                if (WaitForSingleObject(rov.hEvent, 500) == WAIT_OBJECT_0) {
                  GetOverlappedResult(pipe_, &rov, &bytes_read, FALSE);
                  read_ok = TRUE;
                  break;
                }
              }
            } else if (err == ERROR_BROKEN_PIPE || err == ERROR_PIPE_NOT_CONNECTED) {
              CloseHandle(rov.hEvent);
              break;
            }
          }
          CloseHandle(rov.hEvent);
          if (!running_) break;

          if (read_ok && bytes_read > 0) {
            buffer[bytes_read] = '\0';
            fprintf(stdout, "[D2R:%lu] %s", pid_, buffer);
            fflush(stdout);
          }
        }

        fprintf(stdout, "[PID %lu] Client disconnected\n", pid_);
        client_connected_ = false;
        DisconnectNamedPipe(pipe_);

        // Recreate pipe so we can accept a reconnect (e.g., after nyx restart).
        CloseHandle(pipe_);
        pipe_ = INVALID_HANDLE_VALUE;
        if (!CreatePipe_()) break;
      }
    }
  }

  DWORD pid_;
  std::string pipe_name_;
  HANDLE pipe_;
  std::atomic<bool> running_{false};
  std::atomic<bool> client_connected_{false};
  std::thread server_thread_;
};


BOOL WINAPI ConsoleHandler(DWORD signal) {
  if (signal == CTRL_C_EVENT || signal == CTRL_BREAK_EVENT || signal == CTRL_CLOSE_EVENT) {
    fprintf(stdout, "\nShutting down...\n");
    g_running = false;
    return TRUE;
  }
  return FALSE;
}

// Launch a new D2R instance. Returns the new PID, or 0 on failure.
static DWORD LaunchGame(const std::string& exe_path) {
  STARTUPINFOA si{sizeof(si)};
  PROCESS_INFORMATION pi{};

  std::string cmd_line = "\"" + exe_path + "\"";
  if (!CreateProcessA(exe_path.c_str(), cmd_line.data(),
                      nullptr, nullptr, FALSE,
                      0, nullptr, nullptr, &si, &pi)) {
    fprintf(stderr, "Failed to launch '%s': %lu\n", exe_path.c_str(), GetLastError());
    return 0;
  }

  DWORD pid = pi.dwProcessId;
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  fprintf(stdout, "Launched %s (PID %lu)\n", kTargetName, pid);
  return pid;
}

// ------------------------------------------------------------------
// Inject into a PID and start a dedicated pipe server for it.
// ------------------------------------------------------------------
static void ManagePid(DWORD pid, const std::string& dll_path,
                      std::map<DWORD, std::unique_ptr<InstancePipeServer>>& servers) {
  if (servers.count(pid)) return;  // already tracked

  auto srv = std::make_unique<InstancePipeServer>(pid);
  if (!srv->Start()) return;

  // Give the pipe server a moment to start listening before the DLL tries to connect.
  Sleep(50);

  if (!InjectDll(pid, dll_path)) {
    srv->Stop();
    return;
  }

  servers.emplace(pid, std::move(srv));
}

int main(int argc, char* argv[]) {
  SetConsoleCtrlHandler(ConsoleHandler, TRUE);

  // ---- Parse arguments --------------------------------------------------
  bool inject_all = false;   // inject every running D2R.exe
  bool follow_mode = false;  // hide/show overlay as focus switches between instances
  bool launch_mode = false;  // launch a new instance first
  std::string game_path;

  for (int i = 1; i < argc; ++i) {
    if ((strcmp(argv[i], "--launch") == 0 || strcmp(argv[i], "-l") == 0) && i + 1 < argc) {
      launch_mode = true;
      game_path = argv[++i];
    } else if (strcmp(argv[i], "--all") == 0 || strcmp(argv[i], "-a") == 0) {
      inject_all = true;
    } else if (strcmp(argv[i], "--follow") == 0 || strcmp(argv[i], "-f") == 0) {
      follow_mode = true;
    } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
      fprintf(stdout,
              "Usage: %s [options]\n"
              "  (no args)          Inject into the active (foreground) D2R.exe only.\n"
              "                     Other running instances are left untouched.\n"
              "  --follow / -f      Follow focus: hide overlay when a D2R instance loses\n"
              "                     focus and show it again when it regains focus.\n"
              "                     Inject is triggered on first focus of each instance.\n"
              "  --all / -a         Inject into ALL running D2R.exe instances at once.\n"
              "  --launch <path>    Launch D2R.exe from <path> and inject.\n",
              argv[0]);
      return EXIT_SUCCESS;
    } else {
      fprintf(stderr, "Unknown argument: %s  (use --help)\n", argv[i]);
      return EXIT_FAILURE;
    }
  }

  // ---- Resolve DLL path -------------------------------------------------
  std::filesystem::path dll_path = std::filesystem::current_path() / kModuleName;
  std::string dll_path_str = dll_path.string();

  if (!std::filesystem::exists(dll_path)) {
    fprintf(stderr, "DLL not found: %s\n", dll_path_str.c_str());
    return EXIT_FAILURE;
  }

  // ---- Pipe server map: pid -> server -----------------------------------
  std::map<DWORD, std::unique_ptr<InstancePipeServer>> servers;

  // ---- Launch / inject initial set of instances -------------------------
  if (launch_mode) {
    DWORD pid = LaunchGame(game_path);
    if (pid == 0) return EXIT_FAILURE;

    fprintf(stdout, "Waiting for D2R to initialize...\n");
    Sleep(5000);

    ManagePid(pid, dll_path_str, servers);
    if (servers.empty()) {
      fprintf(stderr, "Injection into launched instance failed.\n");
      return EXIT_FAILURE;
    }
  } else {
    auto pids = FindAllProcessesByName(kTargetName);
    if (pids.empty()) {
      fprintf(stderr, "No %s process found.\n", kTargetName);
      if (!inject_all) return EXIT_FAILURE;
    }

    if (inject_all) {
      for (DWORD pid : pids) {
        if (IsModuleLoaded(pid, kModuleName)) {
          fprintf(stdout, "[PID %lu] DLL already loaded, attaching pipe server\n", pid);
          auto srv = std::make_unique<InstancePipeServer>(pid);
          if (srv->Start()) servers.emplace(pid, std::move(srv));
        } else {
          ManagePid(pid, dll_path_str, servers);
        }
      }
    } else {
      // Inject only into the active (foreground) D2R instance.
      DWORD target_pid = GetForegroundD2rPid();
      if (target_pid == 0 && !pids.empty()) {
        // No D2R window is currently in the foreground; fall back to first found.
        target_pid = pids[0];
        fprintf(stdout, "No active D2R window in foreground, using PID %lu\n", target_pid);
      }
      if (target_pid != 0) {
        if (IsModuleLoaded(target_pid, kModuleName)) {
          fprintf(stdout, "[PID %lu] DLL already loaded, attaching pipe server\n", target_pid);
          auto srv = std::make_unique<InstancePipeServer>(target_pid);
          if (srv->Start()) servers.emplace(target_pid, std::move(srv));
        } else {
          ManagePid(target_pid, dll_path_str, servers);
        }
      } else {
        fprintf(stderr, "No %s process found.\n", kTargetName);
        return EXIT_FAILURE;
      }
    }
  }

  // ---- Track the currently active (injected) PID -----------------------
  // Only used in --follow mode.
  DWORD active_pid = servers.empty() ? 0 : servers.begin()->first;

  // ---- Monitoring loop --------------------------------------------------
  if (inject_all) {
    fprintf(stdout, "Monitoring all %s instances... (Ctrl+C to stop)\n", kTargetName);
  } else if (follow_mode) {
    fprintf(stdout,
            "Following active %s window... (Ctrl+C to stop)\n"
            "  Overlay will hide/show as you switch between instances.\n",
            kTargetName);
  } else {
    fprintf(stdout,
            "Injected into PID %lu. Monitoring for exit... (Ctrl+C to stop)\n",
            active_pid);
  }

  while (g_running) {
    // Prune dead processes.
    for (auto it = servers.begin(); it != servers.end();) {
      if (!IsProcessAlive(it->first)) {
        fprintf(stdout, "[PID %lu] Process exited, removing\n", it->first);
        if (it->first == active_pid) active_pid = 0;
        it = servers.erase(it);
      } else {
        ++it;
      }
    }

    if (follow_mode && !inject_all) {
      DWORD fg_pid = GetForegroundD2rPid();

      if (fg_pid != 0 && fg_pid != active_pid) {
        // Hide the instance going to the background.
        if (active_pid != 0 && servers.count(active_pid)) {
          fprintf(stdout, "[PID %lu] Moved to background, hiding UI\n", active_pid);
          servers[active_pid]->SendCommand("hide");
          active_pid = 0;
        }

        // Inject (fresh) or show an already-tracked instance.
        if (!servers.count(fg_pid)) {
          if (IsModuleLoaded(fg_pid, kModuleName)) {
            fprintf(stdout, "[PID %lu] DLL already loaded, reattaching pipe server\n", fg_pid);
            auto srv = std::make_unique<InstancePipeServer>(fg_pid);
            if (srv->Start()) {
              servers.emplace(fg_pid, std::move(srv));
              servers[fg_pid]->SendCommand("show");
              active_pid = fg_pid;
            }
          } else {
            fprintf(stdout, "[PID %lu] Foreground D2R, injecting...\n", fg_pid);
            ManagePid(fg_pid, dll_path_str, servers);
            if (servers.count(fg_pid)) active_pid = fg_pid;
          }
        } else {
          fprintf(stdout, "[PID %lu] Moved to foreground, showing UI\n", fg_pid);
          servers[fg_pid]->SendCommand("show");
          active_pid = fg_pid;
        }
      }
    }
    // Default mode and --all mode: no switching logic.

    Sleep(2000);
  }

  fprintf(stdout, "Stopping all pipe servers...\n");
  servers.clear();
  return EXIT_SUCCESS;
}
