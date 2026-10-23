import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Globe,
  Key,
  Lock,
  Radio,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import {
  getMqttConfig,
  testMqttWebSocketConnection,
  type ConnectionTestResult,
} from '../lib/mqttService';
import { saveIotConfig, resetIotConfig } from '../config/iotConfig';

interface MqttTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTelemetry?: (data: { temp: number; rh: number; soilMoisture: number; rain?: number; rainStatus?: string; lightLux?: number }) => void;
}

export const MqttTestModal: React.FC<MqttTestModalProps> = ({
  isOpen,
  onClose,
  onApplyTelemetry,
}) => {
  const config = getMqttConfig();
  const [username, setUsername] = useState(config.username || 'grenvis_esp32');
  const [password, setPassword] = useState(config.password || 'grenvis123');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [activeTab, setActiveTab] = useState<'browser' | 'hardware' | 'logs'>('browser');
  const [logEntries, setLogEntries] = useState<Array<{ time: string; msg: string; type: 'info' | 'success' | 'warn' | 'error' }>>([
    {
      time: new Date().toLocaleTimeString('id-ID'),
      msg: 'EMQX Diagnostic Module initialized (Zero-Config Mode: Active). Port 8084 (WSS) selected.',
      type: 'info',
    },
  ]);

  if (!isOpen) return null;

  const appendLog = (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    setLogEntries((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString('id-ID'), msg, type },
    ]);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    appendLog(`Memulai uji jabat tangan WebSocket (WSS) ke ${config.host}:8084/mqtt...`, 'info');

    try {
      const res = await testMqttWebSocketConnection({ username, password });
      setTestResult(res);

      if (res.success) {
        appendLog(`✓ ${res.message}`, 'success');
      } else if (res.state === 'auth_required') {
        appendLog(`! ${res.message}`, 'warn');
        appendLog('Perlu konfigurasi akun di EMQX Console: Authentication -> Password-Based.', 'warn');
      } else {
        appendLog(`✗ ${res.message}`, 'error');
      }
    } catch (err: any) {
      appendLog(`✗ Error uji koneksi: ${err?.message || err}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleSimulateReceive = () => {
    if (onApplyTelemetry) {
      const hasRain = Math.random() > 0.6;
      const mock = {
        temp: Number((26 + Math.random() * 8).toFixed(1)),
        rh: Math.round(35 + Math.random() * 30),
        soilMoisture: Number((22 + Math.random() * 15).toFixed(1)),
        rain: hasRain ? Number((Math.random() * 6).toFixed(1)) : 0.0,
        rainStatus: hasRain ? 'GERIMIS' : 'KERING',
        lightLux: Math.round(15000 + Math.random() * 60000),
      };
      onApplyTelemetry(mock);
      appendLog(`Simulasi paket telemetri diterima: Suhu ${mock.temp}°C, RH ${mock.rh}%, Tanah ${mock.soilMoisture}%, Hujan ${mock.rain} mm/h (${mock.rainStatus}), Cahaya ${mock.lightLux} Lux`, 'success');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-2xl bg-[#F8FAF7] border border-[#A6B49E] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#D6DCCE] flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#263A35] flex items-center justify-center text-[#5DD62C] shadow-xs">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-base text-[#263A35]">
                  EMQX Cloud Broker Diagnostics
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EFF3EF] text-[#263A35] border border-[#A6B49E]">
                  Cluster: asia-southeast1
                </span>
              </div>
              <p className="text-xs text-[#50645F] mt-0.5">
                Konfigurasi &amp; Pengujian Port EMQX untuk Dashboard &amp; Hardware
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#50645F] hover:bg-[#EFF3EF] hover:text-[#263A35] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[#D6DCCE] bg-[#EFF3EF]/60 px-4 pt-2 gap-2 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('browser')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'browser'
                ? 'border-[#263A35] text-[#263A35]'
                : 'border-transparent text-[#50645F] hover:text-[#263A35]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Dashboard Browser (Port 8084 WSS)</span>
          </button>
          <button
            onClick={() => setActiveTab('hardware')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'hardware'
                ? 'border-[#263A35] text-[#263A35]'
                : 'border-transparent text-[#50645F] hover:text-[#263A35]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>ESP32 Hardware (Port 8883 TLS)</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'logs'
                ? 'border-[#263A35] text-[#263A35]'
                : 'border-transparent text-[#50645F] hover:text-[#263A35]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Diagnostic Logs ({logEntries.length})</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {activeTab === 'browser' && (
            <div className="space-y-4">
              {/* Architecture callout */}
              <div className="p-3.5 rounded-xl bg-white border border-[#D6DCCE] shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#263A35] text-xs">Adaptasi Port Browser vs Hardware:</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#5DD62C]/15 text-[#1e580e] font-mono font-bold">
                    PORT 8084 AKTIF
                  </span>
                </div>
                <p className="text-[#50645F] text-[11px] leading-relaxed">
                  Web browser tidak dapat membuka socket TCP mentah ke port <strong>8883</strong> karena batasan keamanan browser.
                  Oleh karena itu, dashboard web AGRAPATHA menggunakan <strong>WebSocket over TLS/SSL (WSS)</strong> pada <strong>Port 8084</strong>.
                </p>
                <div className="font-mono text-[10px] bg-[#EFF3EF] p-2 rounded-lg text-[#263A35] break-all border border-[#A6B49E]">
                  URL WSS: {config.brokerUrl}
                </div>
              </div>

              {/* Credentials Form */}
              <div className="p-4 rounded-xl bg-white border border-[#D6DCCE] space-y-3 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#263A35]" />
                  <span className="font-bold text-[#263A35]">Kredensial Otentikasi EMQX (Opsional)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#50645F] uppercase mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. agrapatha_client"
                      className="w-full px-3 py-1.5 rounded-lg border border-[#D6DCCE] text-xs font-mono focus:outline-hidden focus:border-[#263A35] bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#50645F] uppercase mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="e.g. **********"
                      className="w-full px-3 py-1.5 rounded-lg border border-[#D6DCCE] text-xs font-mono focus:outline-hidden focus:border-[#263A35] bg-white"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-[#50645F]">
                  * Dibuat melalui menu <em>Authentication &gt; Password-Based</em> di EMQX Cloud Console.
                </p>
              </div>

              {/* Result banner */}
              {testResult && (
                <div
                  className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                    testResult.success
                      ? 'bg-[#5DD62C]/10 border-[#5DD62C]/40 text-[#1e580e]'
                      : testResult.state === 'auth_required'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-red-50 border-red-300 text-red-900'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  )}
                  <div className="space-y-1">
                    <p className="font-bold text-xs">{testResult.message}</p>
                    {testResult.latencyMs && (
                      <p className="text-[10px] font-mono">Latensi Jaringan: {testResult.latencyMs} ms</p>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-2 rounded-xl bg-[#263A35] text-white hover:bg-[#1f2f2b] transition-all font-bold text-xs flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  <Activity className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                  <span>{testing ? 'Menguji Koneksi WSS...' : 'Uji Koneksi WSS (Port 8084)'}</span>
                </button>

                <button
                  onClick={() => {
                    saveIotConfig({ emqx: { username, password } });
                    appendLog('Pengaturan tersimpan ke browser (localStorage). Tidak membutuhkan file .env!', 'success');
                    setSavedToast(true);
                    setTimeout(() => setSavedToast(false), 2500);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-[#A6B49E] bg-white hover:bg-[#EFF3EF] text-[#263A35] transition-all font-bold text-xs flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5 text-[#263A35]" />
                  <span>{savedToast ? 'Tersimpan ke Browser!' : 'Simpan (Tanpa .env)'}</span>
                </button>

                <button
                  onClick={() => {
                    resetIotConfig();
                    const def = getMqttConfig();
                    setUsername(def.username);
                    setPassword(def.password || '');
                    appendLog('Konfigurasi dikembalikan ke pengaturan awal pabrik (default).', 'info');
                  }}
                  className="px-2.5 py-2 rounded-xl border border-[#D6DCCE] bg-white hover:bg-[#EFF3EF] text-[#50645F] hover:text-[#263A35] transition-all text-xs"
                  title="Kembalikan ke Default Pabrik"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleSimulateReceive}
                  className="px-3.5 py-2 rounded-xl border border-[#A6B49E] bg-white hover:bg-[#EFF3EF] text-[#263A35] transition-all font-bold text-xs flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5 text-[#5DD62C]" />
                  <span>Simulasi Telemetri ESP32</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'hardware' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-white border border-[#D6DCCE] shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#263A35] text-xs">Konfigurasi ESP32 &amp; ESP32-CAM:</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#263A35] text-[#5DD62C] font-mono font-bold">
                    PORT 8883 (MQTTS TLS)
                  </span>
                </div>
                <p className="text-[#50645F] text-[11px] leading-relaxed">
                  Perangkat mikrokontroler (ESP32) terhubung langsung menggunakan TCP TLS murni pada port <strong>8883</strong> dengan library <code>WiFiClientSecure</code> dan <code>PubSubClient</code>.
                </p>
              </div>

              <div className="p-3 bg-[#1e2724] rounded-xl text-[#F4F7F5] font-mono text-[11px] space-y-1 overflow-x-auto border border-[#263A35]">
                <p className="text-[#5DD62C] font-bold">// C++ Header: firmware/esp32_emqx_config.h</p>
                <p>#define MQTT_BROKER_HOST &quot;{config.host}&quot;</p>
                <p>#define MQTT_TLS_PORT    8883  // Native TLS Port</p>
                <p>#define TOPIC_TELEMETRY  &quot;{config.topics.telemetry}&quot;</p>
                <p>#define TOPIC_COMMANDS   &quot;{config.topics.commands}&quot;</p>
              </div>

              <div className="p-3 rounded-xl bg-[#EFF3EF] border border-[#A6B49E] text-[11px] text-[#263A35] space-y-1">
                <span className="font-bold block">Uji Mandiri Melalui CLI Terminal:</span>
                <p className="font-mono text-[10px] bg-white p-2 rounded-lg border border-[#D6DCCE]">
                  node scripts/test-emqx.mjs --username &lt;user&gt; --password &lt;pass&gt;
                </p>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-2">
              <div className="h-60 p-3 rounded-xl bg-[#1e2724] text-[#E0E7E3] font-mono text-[10px] overflow-y-auto space-y-1.5 border border-[#263A35]">
                {logEntries.map((log, i) => (
                  <div key={i} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-[#A6B49E] shrink-0">[{log.time}]</span>
                    <span
                      className={
                        log.type === 'success'
                          ? 'text-[#5DD62C]'
                          : log.type === 'warn'
                          ? 'text-amber-300'
                          : log.type === 'error'
                          ? 'text-red-400'
                          : 'text-slate-300'
                      }
                    >
                      {log.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-[#D6DCCE] bg-white flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-[#50645F]">
            <Lock className="w-3.5 h-3.5 text-[#5DD62C]" />
            <span>TLSv1.3 Encrypted Pipeline</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-[#D6DCCE] bg-[#EFF3EF] hover:bg-[#D6DCCE] text-[#263A35] font-semibold text-xs transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
