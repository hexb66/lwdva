from flask import Flask, render_template, request, jsonify
import numpy as np
from scipy import signal
import argparse

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/fft', methods=['POST'])
def fft_analysis():
    data = request.get_json()
    result = {}
    
    # 检查是否为多组数据
    if isinstance(data.get('data'), list) and isinstance(data.get('data')[0], list):
        # 多组数据处理
        signals = data.get('data', [])
        names = data.get('names', [])
        sample_rate = float(data.get('sample_rate', 1000))
        
        result['series'] = []
        
        for i, signal_data in enumerate(signals):
            signal_data = np.array(signal_data, dtype=float)
            
            # 应用窗函数减少频谱泄漏
            window = signal.windows.hann(len(signal_data))
            windowed_signal = signal_data * window
            
            fft_result = np.fft.fft(windowed_signal)
            freqs = np.fft.fftfreq(len(signal_data), d=1/sample_rate)
            
            # 为每组数据保存结果
            series_result = {
                'name': names[i] if i < len(names) else f"Series {i+1}",
                'frequencies': freqs.tolist(),
                'magnitude': np.abs(fft_result).tolist()
            }
            result['series'].append(series_result)
    else:
        # 单组数据处理（保持向后兼容）
        signal_data = np.array(data.get('data', []), dtype=float)
        sample_rate = float(data.get('sample_rate', 1000))
        
        # 应用窗函数减少频谱泄漏
        window = signal.windows.hann(len(signal_data))
        windowed_signal = signal_data * window
        
        fft_result = np.fft.fft(windowed_signal)
        freqs = np.fft.fftfreq(len(signal_data), d=1/sample_rate)
        
        # 处理结果
        result = {
            'frequencies': freqs.tolist(),
            'magnitude': np.abs(fft_result).tolist()
        }
    
    return jsonify(result)

@app.route('/api/filter', methods=['POST'])
def apply_filter():
    try:
        data = request.get_json()
        result = {}
        
        # 检查是否为多组数据
        if isinstance(data.get('data'), list) and isinstance(data.get('data')[0], list):
            # 多组数据处理
            signals = data.get('data', [])
            names = data.get('names', [])
            sample_rate = float(data.get('sample_rate', 1000))
            filter_type = data.get('filter_type', 'lowpass')
            cutoff_freq = float(data.get('cutoff_freq', 100))
            cutoff_freq2 = float(data.get('cutoff_freq2', 200))
            filter_order = int(data.get('filter_order', 4))
            zero_phase = data.get('zero_phase', True)
            
            # 归一化截止频率
            nyquist = 0.5 * sample_rate
            
            # 设计滤波器
            if filter_type == 'lowpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='low')
            elif filter_type == 'highpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='high')
            elif filter_type == 'bandpass':
                if cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带通滤波器的低截止频率必须小于高截止频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='band')
            elif filter_type == 'bandstop':
                if cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带阻滤波器的低截止频率必须小于高截止频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='bandstop')
            else:
                return jsonify({'error': '不支持的滤波器类型'}), 400
                
            result['series'] = []
            
            # 对每组数据应用相同的滤波器
            for i, signal_data in enumerate(signals):
                signal_data = np.array(signal_data, dtype=float)
                
                # 应用滤波器
                if zero_phase:
                    # 零相位滤波
                    filtered_data = signal.filtfilt(b, a, signal_data)
                else:
                    # 常规IIR滤波
                    filtered_data = signal.lfilter(b, a, signal_data)
                
                # 保存结果
                series_result = {
                    'name': names[i] if i < len(names) else f"Series {i+1}",
                    'filtered_data': filtered_data.tolist()
                }
                result['series'].append(series_result)
                
            # 添加滤波器信息
            result['filter_info'] = {
                'type': filter_type,
                'order': filter_order,
                'cutoff_freq': cutoff_freq,
                'cutoff_freq2': cutoff_freq2 if filter_type in ['bandpass', 'bandstop'] else None,
                'zero_phase': zero_phase
            }
        else:
            # 单组数据处理（保持向后兼容）
            signal_data = np.array(data.get('data', []), dtype=float)
            sample_rate = float(data.get('sample_rate', 1000))
            filter_type = data.get('filter_type', 'lowpass')
            cutoff_freq = float(data.get('cutoff_freq', 100))
            cutoff_freq2 = float(data.get('cutoff_freq2', 200))
            filter_order = int(data.get('filter_order', 4))
            zero_phase = data.get('zero_phase', True)
            
            # 归一化截止频率 (Wn = 2 * cutoff_freq / sample_rate)
            nyquist = 0.5 * sample_rate
            
            # 设计滤波器
            if filter_type == 'lowpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='low')
            elif filter_type == 'highpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='high')
            elif filter_type == 'bandpass':
                if cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带通滤波器的低截止频率必须小于高截止频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='band')
            elif filter_type == 'bandstop':
                if cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带阻滤波器的低截止频率必须小于高截止频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='bandstop')
            else:
                return jsonify({'error': '不支持的滤波器类型'}), 400
            
            # 应用滤波器
            if zero_phase:
                # 使用前向-后向滤波实现零相位滤波
                filtered_data = signal.filtfilt(b, a, signal_data)
            else:
                # 常规IIR滤波，会有相位延时
                filtered_data = signal.lfilter(b, a, signal_data)
            
            # 返回滤波后的数据
            result = {
                'filtered_data': filtered_data.tolist(),
                'filter_info': {
                    'type': filter_type,
                    'order': filter_order,
                    'cutoff_freq': cutoff_freq,
                    'cutoff_freq2': cutoff_freq2 if filter_type in ['bandpass', 'bandstop'] else None,
                    'zero_phase': zero_phase
                }
            }
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def main():
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description='数据可视化与分析工具')
    parser.add_argument('--host', default='127.0.0.1', help='应用监听的IP地址 (默认: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=5000, help='应用监听的端口 (默认: 5000)')
    parser.add_argument('--debug', action='store_true', help='是否启用调试模式 (默认: 不启用)')
    
    # 解析命令行参数
    args = parser.parse_args()
    
    print(f"启动数据可视化与分析工具 (LWDVA)...")
    print(f"访问 http://{args.host}:{args.port} 使用应用")
    
    # 使用命令行参数启动应用
    app.run(host=args.host, port=args.port, debug=args.debug)

if __name__ == '__main__':
    main()