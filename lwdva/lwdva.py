import json

from flask import Flask, Response, render_template, request, jsonify
import argparse
import io
import os
import struct
import tempfile
import threading
import uuid
import numpy as np
from scipy import signal

try:
    import pandas as pd
    _HAS_PANDAS = True
except ImportError:
    pd = None
    _HAS_PANDAS = False

app = Flask(__name__, template_folder='../templates', static_folder='../static')
# 允许上传大体积 CSV（默认 Werkzeug 无上限，此处显式放宽常见部署限制）
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024

def _parse_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def _validate_sample_rate(sample_rate):
    if sample_rate is None or not np.isfinite(sample_rate) or sample_rate <= 0:
        return '采样频率必须为正数'
    return None

def _normalize_signals(data_field):
    if not data_field:
        return None, '未提供有效的数据'
    # 多组数据
    if isinstance(data_field, list) and len(data_field) > 0 and isinstance(data_field[0], list):
        return data_field, None
    # 单组数据
    return [data_field], None

def _coerce_numeric_array(array, name):
    if np.iscomplexobj(array):
        if np.allclose(array.imag, 0):
            array = array.real
        else:
            return None, f'数组 {name} 为复数类型，无法绘制'
    if not np.issubdtype(array.dtype, np.number):
        try:
            array = array.astype(float)
        except (TypeError, ValueError):
            return None, f'数组 {name} 不是数值类型'
    return array.astype(float), None

def _npz_to_table(npz_file):
    headers = []
    columns = []
    metadata = {}
    for key in npz_file.files:
        array = np.array(npz_file[key])
        if array.ndim == 0:
            coerced, error = _coerce_numeric_array(array, key)
            if error:
                return None, error
            metadata[key] = float(coerced.reshape(1)[0])
            continue
        if array.ndim == 1:
            coerced, error = _coerce_numeric_array(array, key)
            if error:
                return None, error
            headers.append(key)
            columns.append(coerced)
        elif array.ndim >= 2:
            coerced, error = _coerce_numeric_array(array, key)
            if error:
                return None, error
            leading = coerced.shape[0]
            trailing_shape = coerced.shape[1:]
            flattened = coerced.reshape(leading, -1)
            for flat_index, index_tuple in enumerate(np.ndindex(*trailing_shape)):
                label = ','.join(str(i) for i in index_tuple)
                headers.append(f"{key}[{label}]")
                columns.append(flattened[:, flat_index])

    if not headers:
        return None, 'npz中未找到可用数组'

    lengths = [len(col) for col in columns]
    max_len = max(lengths)
    rows = [[None for _ in range(len(headers))] for _ in range(max_len)]
    for col_idx, col in enumerate(columns):
        last_value = None
        for row_idx, value in enumerate(col):
            if np.isfinite(value):
                last_value = float(value)
                rows[row_idx][col_idx] = last_value
            else:
                rows[row_idx][col_idx] = last_value
        if len(col) < max_len and last_value is not None:
            for row_idx in range(len(col), max_len):
                rows[row_idx][col_idx] = last_value

    warnings = {}
    if len(set(lengths)) > 1:
        warnings['lengths'] = {headers[i]: lengths[i] for i in range(len(headers))}
        warnings['max_length'] = max_len

    return {
        'headers': headers,
        'rows': rows,
        'metadata': metadata,
        'warnings': warnings
    }, None


def _parse_delimited_line(line, delimiter):
    """与前端 parseDelimitedLine 一致：单字符分隔符支持引号转义。"""
    if not delimiter or len(delimiter) != 1:
        sep = delimiter if delimiter else ','
        return line.split(sep)
    d = delimiter[0]
    fields = []
    current = []
    in_quotes = False
    i = 0
    n = len(line)
    while i < n:
        char = line[i]
        if char == '"':
            nxt = line[i + 1] if i + 1 < n else ''
            if in_quotes and nxt == '"':
                current.append('"')
                i += 2
                continue
            in_quotes = not in_quotes
            i += 1
            continue
        if char == d and not in_quotes:
            fields.append(''.join(current))
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    fields.append(''.join(current))
    return fields


def _csv_stream_to_table(text_stream, delimiter):
    """按行流式读取，避免整文件读入单个字符串（与前端 parseDelimitedContent 行为对齐）。"""
    warnings = {
        'paddedLines': [],
        'trimmedLines': [],
        'malformedLines': [],
        'nonNumericCount': 0,
    }
    headers = None
    rows = []
    last_values = None
    line_no = 0

    for raw_line in text_stream:
        line_no += 1
        line = raw_line.rstrip('\r\n')
        if headers is None:
            if line.strip() == '':
                continue
            raw_headers = _parse_delimited_line(line, delimiter)
            headers = [h.strip() for h in raw_headers]
            last_values = [0.0] * len(headers)
            continue
        if line.strip() == '':
            continue
        fields = _parse_delimited_line(line, delimiter)
        if len(fields) < len(headers):
            warnings['paddedLines'].append(line_no)
            while len(fields) < len(headers):
                fields.append('')
        elif len(fields) > len(headers):
            warnings['trimmedLines'].append(line_no)
            del fields[len(headers):]

        numeric_row = []
        for index, value in enumerate(fields):
            trimmed = value.strip()
            if trimmed == '':
                numeric_row.append(last_values[index])
                continue
            try:
                num = float(trimmed)
            except (TypeError, ValueError):
                warnings['nonNumericCount'] += 1
                numeric_row.append(last_values[index])
                continue
            if not np.isfinite(num):
                warnings['nonNumericCount'] += 1
                numeric_row.append(last_values[index])
                continue
            last_values[index] = num
            numeric_row.append(num)
        rows.append(numeric_row)

    if headers is None:
        return None, '文件为空'

    return {
        'headers': headers,
        'rows': rows,
        'metadata': {},
        'warnings': warnings,
    }, None


_csv_jobs = {}
_csv_jobs_lock = threading.Lock()


def _csv_job_update(job_id, **kwargs):
    with _csv_jobs_lock:
        if job_id in _csv_jobs:
            _csv_jobs[job_id].update(kwargs)


class _ProgressBinaryReader(io.RawIOBase):
    """包装二进制读，根据已读字节更新解析进度（供 pandas 读大文件时回调）。"""

    def __init__(self, path, job_id, total_size):
        super().__init__()
        self._path = path
        self._f = open(path, 'rb')
        self._job_id = job_id
        self._total = max(total_size, 1)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self._f.tell()

    def seek(self, offset, whence=io.SEEK_SET):
        pos = self._f.seek(offset, whence)
        self._report()
        return pos

    def read(self, size=-1):
        data = self._f.read(size)
        self._report()
        return data

    def readinto(self, b):
        n = self._f.readinto(b)
        self._report()
        return n

    def close(self):
        if self._f:
            self._f.close()
            self._f = None

    def _report(self):
        if not self._f:
            return
        pos = self._f.tell()
        # 读文件只占整体进度的一部分，避免读完后长时间卡在 99%（后续数值整理与 tolist 很慢）
        pct = min(62, int(62 * pos / self._total))
        _csv_job_update(self._job_id, phase='parse', percent=pct)


def _csv_pandas_file_to_table(path, delimiter, job_id=None, file_size=None):
    """使用 pandas C 引擎解析，数值规则与前端一致：无法解析的单元格前向填充，首部缺省为 0。"""
    if not _HAS_PANDAS:
        return None, '未安装 pandas，请执行 pip install pandas'

    sep = delimiter if delimiter else ','
    engine = 'c' if len(sep) == 1 else 'python'
    read_kw = {
        'filepath_or_buffer': path,
        'sep': sep,
        'header': 0,
        'encoding': 'utf-8-sig',
        'engine': engine,
        'low_memory': False,
        'skipinitialspace': True,
    }
    buffer = path
    if job_id is not None and file_size:
        buffer = _ProgressBinaryReader(path, job_id, file_size)
        read_kw['filepath_or_buffer'] = buffer

    warnings_out = {
        'paddedLines': [],
        'trimmedLines': [],
        'malformedLines': [],
        'nonNumericCount': 0,
    }

    try:
        df = pd.read_csv(**read_kw)
    except Exception:
        return None, None
    finally:
        if isinstance(buffer, _ProgressBinaryReader):
            buffer.close()

    if len(df.columns) == 0:
        return None, '文件为空'

    if job_id:
        _csv_job_update(job_id, phase='parse', percent=64)

    headers = [str(c).strip() for c in df.columns.tolist()]
    stripped = df.apply(lambda col: col.astype(str).str.strip())
    if job_id:
        _csv_job_update(job_id, phase='parse', percent=70)
    coerced = stripped.apply(pd.to_numeric, errors='coerce')
    non_blank = stripped.ne('') & stripped.notna()
    warnings_out['nonNumericCount'] = int((non_blank & coerced.isna()).sum().sum())
    if job_id:
        _csv_job_update(job_id, phase='parse', percent=76)
    filled = coerced.ffill(axis=0).fillna(0.0)
    arr = filled.to_numpy(dtype=np.float64)
    if not np.all(np.isfinite(arr)):
        warnings_out['nonNumericCount'] += int((~np.isfinite(arr)).sum())
    arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
    if job_id:
        _csv_job_update(job_id, phase='parse', percent=98)
    # 保留二维 ndarray，避免 tolist 占用双倍内存；大文件由 /api/csv/result?format=binary 下发
    return {
        'headers': headers,
        'matrix': np.ascontiguousarray(arr, dtype=np.float64),
        'rows': None,
        'metadata': {},
        'warnings': warnings_out,
    }, None


def _csv_file_to_table_best_effort(path, delimiter, job_id=None, file_size=None):
    """优先 pandas；失败则回退到流式逐行解析（较慢，兼容怪异格式）。"""
    if _HAS_PANDAS:
        result, err = _csv_pandas_file_to_table(path, delimiter, job_id, file_size)
        if err is None and result is not None:
            return result, None
        if err:
            return None, err

    try:
        with open(path, 'r', encoding='utf-8-sig', newline='') as f:
            return _csv_stream_to_table(f, delimiter)
    except UnicodeDecodeError as e:
        return None, f'文件编码无法按 UTF-8 解码: {e}'
    except Exception as e:
        return None, str(e)


def _serialize_csv_result_binary(result):
    """
    二进制格式（避免超大 JSON 超出浏览器单字符串 / JSON.parse 限制）:
    uint32 LE: meta_json 字节长度
    meta_json: UTF-8 JSON，含 headers, warnings, metadata, n_rows, n_cols
    0~7 字节 0 填充，使 float64 区起始偏移为 8 的倍数（否则 JS 的 Float64Array(buffer,off) 会抛错）
    其后 n_rows * n_cols 个 float64，C 连续、行主序（与 numpy C 顺序一致）
    """
    if result.get('matrix') is not None:
        arr = np.ascontiguousarray(result['matrix'], dtype=np.float64)
    else:
        rows = result.get('rows')
        if not rows:
            arr = np.zeros((0, len(result.get('headers') or [])), dtype=np.float64)
        else:
            arr = np.ascontiguousarray(np.array(rows, dtype=np.float64))
    if arr.ndim != 2:
        raise ValueError('内部数据维度应为二维')
    n_r = int(arr.shape[0])
    n_c = int(arr.shape[1])
    meta = {
        'headers': [str(h) for h in (result.get('headers') or [])],
        'warnings': result.get('warnings') or {},
        'metadata': result.get('metadata') or {},
        'n_rows': n_r,
        'n_cols': n_c,
    }
    meta_json = json.dumps(meta, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(meta_json) > 64 * 1024 * 1024:
        raise ValueError('列名或元数据过大')
    header = struct.pack('<I', len(meta_json)) + meta_json
    align_pad = (8 - (len(header) % 8)) % 8
    header += b'\x00' * align_pad
    if arr.size:
        return header + memoryview(arr).tobytes()
    return header


def _run_csv_parse_job(job_id):
    path = None
    try:
        with _csv_jobs_lock:
            job = _csv_jobs.get(job_id)
            if not job:
                return
            path = job['path']
            delimiter = job['delimiter']
            size = job['size']

        _csv_job_update(job_id, status='parsing', phase='parse', percent=0)
        result, error = _csv_file_to_table_best_effort(path, delimiter, job_id, size)

        if error:
            _csv_job_update(job_id, status='error', error=error, percent=100)
            return

        _csv_job_update(job_id, status='done', phase='done', percent=100, result=result)
    except Exception as e:
        _csv_job_update(job_id, status='error', error=str(e), percent=100)
    finally:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/fft', methods=['POST'])
def fft_analysis():
    data = request.get_json(silent=True) or {}
    result = {}
    
    signals, error = _normalize_signals(data.get('data'))
    if error:
        return jsonify({'error': error}), 400
    
    sample_rate = _parse_float(data.get('sample_rate', 1000))
    error = _validate_sample_rate(sample_rate)
    if error:
        return jsonify({'error': error}), 400
    
    # 检查是否为多组数据
    if isinstance(data.get('data'), list) and isinstance(data.get('data')[0], list):
        # 多组数据处理
        names = data.get('names', [])
        
        result['series'] = []
        
        for i, signal_data in enumerate(signals):
            signal_data = np.array(signal_data, dtype=float)
            if signal_data.size < 2:
                return jsonify({'error': '每组数据至少需要2个采样点'}), 400
            
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
        if signal_data.size < 2:
            return jsonify({'error': '数据至少需要2个采样点'}), 400
        
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
        data = request.get_json(silent=True) or {}
        result = {}
        
        signals, error = _normalize_signals(data.get('data'))
        if error:
            return jsonify({'error': error}), 400
        
        # 检查是否为多组数据
        if isinstance(data.get('data'), list) and isinstance(data.get('data')[0], list):
            # 多组数据处理
            names = data.get('names', [])
            sample_rate = _parse_float(data.get('sample_rate', 1000))
            filter_type = data.get('filter_type', 'lowpass')
            cutoff_freq = _parse_float(data.get('cutoff_freq', 100))
            cutoff_freq2 = _parse_float(data.get('cutoff_freq2', 200))
            filter_order = int(data.get('filter_order', 4))
            zero_phase = data.get('zero_phase', True)
            
            # 归一化截止频率
            error = _validate_sample_rate(sample_rate)
            if error:
                return jsonify({'error': error}), 400
            if cutoff_freq is None or cutoff_freq <= 0:
                return jsonify({'error': '截止频率必须为正数'}), 400
            if filter_order < 1:
                return jsonify({'error': '滤波器阶数必须为正整数'}), 400
            nyquist = 0.5 * sample_rate
            if cutoff_freq >= nyquist:
                return jsonify({'error': '截止频率必须小于奈奎斯特频率'}), 400
            
            # 设计滤波器
            if filter_type == 'lowpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='low')
            elif filter_type == 'highpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='high')
            elif filter_type == 'bandpass':
                if cutoff_freq2 is None or cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带通滤波器的低截止频率必须小于高截止频率'}), 400
                if cutoff_freq2 >= nyquist:
                    return jsonify({'error': '高截止频率必须小于奈奎斯特频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='band')
            elif filter_type == 'bandstop':
                if cutoff_freq2 is None or cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带阻滤波器的低截止频率必须小于高截止频率'}), 400
                if cutoff_freq2 >= nyquist:
                    return jsonify({'error': '高截止频率必须小于奈奎斯特频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='bandstop')
            else:
                return jsonify({'error': '不支持的滤波器类型'}), 400
                
            result['series'] = []
            padlen = 3 * (max(len(a), len(b)) - 1)
            
            # 对每组数据应用相同的滤波器
            for i, signal_data in enumerate(signals):
                signal_data = np.array(signal_data, dtype=float)
                if signal_data.size < 2:
                    return jsonify({'error': '每组数据至少需要2个采样点'}), 400
                if zero_phase and signal_data.size <= padlen:
                    return jsonify({'error': '数据长度过短，无法进行零相位滤波'}), 400
                
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
            sample_rate = _parse_float(data.get('sample_rate', 1000))
            filter_type = data.get('filter_type', 'lowpass')
            cutoff_freq = _parse_float(data.get('cutoff_freq', 100))
            cutoff_freq2 = _parse_float(data.get('cutoff_freq2', 200))
            filter_order = int(data.get('filter_order', 4))
            zero_phase = data.get('zero_phase', True)
            
            # 归一化截止频率 (Wn = 2 * cutoff_freq / sample_rate)
            error = _validate_sample_rate(sample_rate)
            if error:
                return jsonify({'error': error}), 400
            if cutoff_freq is None or cutoff_freq <= 0:
                return jsonify({'error': '截止频率必须为正数'}), 400
            if filter_order < 1:
                return jsonify({'error': '滤波器阶数必须为正整数'}), 400
            nyquist = 0.5 * sample_rate
            if cutoff_freq >= nyquist:
                return jsonify({'error': '截止频率必须小于奈奎斯特频率'}), 400
            
            # 设计滤波器
            if filter_type == 'lowpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='low')
            elif filter_type == 'highpass':
                b, a = signal.butter(filter_order, cutoff_freq / nyquist, btype='high')
            elif filter_type == 'bandpass':
                if cutoff_freq2 is None or cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带通滤波器的低截止频率必须小于高截止频率'}), 400
                if cutoff_freq2 >= nyquist:
                    return jsonify({'error': '高截止频率必须小于奈奎斯特频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='band')
            elif filter_type == 'bandstop':
                if cutoff_freq2 is None or cutoff_freq >= cutoff_freq2:
                    return jsonify({'error': '带阻滤波器的低截止频率必须小于高截止频率'}), 400
                if cutoff_freq2 >= nyquist:
                    return jsonify({'error': '高截止频率必须小于奈奎斯特频率'}), 400
                b, a = signal.butter(filter_order, [cutoff_freq / nyquist, cutoff_freq2 / nyquist], btype='bandstop')
            else:
                return jsonify({'error': '不支持的滤波器类型'}), 400
            
            # 应用滤波器
            if signal_data.size < 2:
                return jsonify({'error': '数据至少需要2个采样点'}), 400
            padlen = 3 * (max(len(a), len(b)) - 1)
            if zero_phase and signal_data.size <= padlen:
                return jsonify({'error': '数据长度过短，无法进行零相位滤波'}), 400
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

@app.route('/api/npz', methods=['POST'])
def load_npz():
    if 'file' not in request.files:
        return jsonify({'error': '缺少npz文件'}), 400
    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({'error': '文件名为空'}), 400
    try:
        with np.load(file, allow_pickle=False) as npz_file:
            result, error = _npz_to_table(npz_file)
            if error:
                return jsonify({'error': error}), 400
            return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'无法解析npz文件: {e}'}), 400


@app.route('/api/csv/upload', methods=['POST'])
def csv_upload():
    """大文件分步导入：先上传落盘，返回 job_id（便于前端显示上传进度）。"""
    if 'file' not in request.files:
        return jsonify({'error': '缺少文件'}), 400
    upload = request.files['file']
    if not upload or upload.filename == '':
        return jsonify({'error': '文件名为空'}), 400
    delim_raw = request.form.get('delimiter') or ','
    delimiter = delim_raw.replace('\\t', '\t')
    job_id = str(uuid.uuid4())
    fd, path = tempfile.mkstemp(prefix='lwdva_csv_', suffix='.upload')
    os.close(fd)
    try:
        upload.stream.seek(0)
        upload.save(path)
        size = os.path.getsize(path)
        with _csv_jobs_lock:
            _csv_jobs[job_id] = {
                'path': path,
                'delimiter': delimiter,
                'size': size,
                'status': 'uploaded',
                'phase': 'upload',
                'percent': 0,
                'error': None,
                'result': None,
            }
        return jsonify({'job_id': job_id, 'size': size})
    except Exception as e:
        try:
            os.remove(path)
        except OSError:
            pass
        return jsonify({'error': f'保存上传文件失败: {e}'}), 500


@app.route('/api/csv/parse', methods=['POST'])
def csv_parse_start():
    """在后台线程解析已上传的 CSV（客户端轮询 /api/csv/status）。"""
    data = request.get_json(silent=True) or {}
    job_id = data.get('job_id')
    if not job_id:
        return jsonify({'error': '缺少 job_id'}), 400
    with _csv_jobs_lock:
        job = _csv_jobs.get(job_id)
        if not job:
            return jsonify({'error': '无效或已过期的任务'}), 404
        if job['status'] != 'uploaded':
            return jsonify({'error': '任务状态不允许再次解析'}), 400
        job['status'] = 'queued'
        job['error'] = None
        job['result'] = None
    thread = threading.Thread(target=_run_csv_parse_job, args=(job_id,), daemon=True)
    thread.start()
    return jsonify({'ok': True})


@app.route('/api/csv/status', methods=['GET'])
def csv_status():
    job_id = request.args.get('job_id')
    if not job_id:
        return jsonify({'error': '缺少 job_id'}), 400
    with _csv_jobs_lock:
        job = _csv_jobs.get(job_id)
        if not job:
            return jsonify({'error': '无效或已过期的任务'}), 404
        return jsonify({
            'status': job['status'],
            'phase': job.get('phase', ''),
            'percent': job.get('percent', 0),
            'error': job.get('error'),
        })


@app.route('/api/csv/result', methods=['GET'])
def csv_result():
    job_id = request.args.get('job_id')
    if not job_id:
        return jsonify({'error': '缺少 job_id'}), 400
    with _csv_jobs_lock:
        job = _csv_jobs.get(job_id)
        if not job:
            return jsonify({'error': '无效或已过期的任务'}), 404
        if job['status'] == 'error':
            err = job.get('error') or '解析失败'
            del _csv_jobs[job_id]
            return jsonify({'error': err}), 400
        if job['status'] != 'done' or job.get('result') is None:
            return jsonify({'error': '解析尚未完成'}), 400
        result = job['result']
        del _csv_jobs[job_id]

    accept = request.headers.get('Accept') or ''
    want_binary = (
        request.args.get('format') == 'binary'
        or 'application/vnd.lwdva.csv-matrix' in accept
    )
    if want_binary:
        try:
            body = _serialize_csv_result_binary(result)
        except (ValueError, TypeError) as e:
            return jsonify({'error': f'二进制序列化失败: {e}'}), 500
        return Response(
            body,
            mimetype='application/vnd.lwdva.csv-matrix',
            headers={'X-Content-Type-Options': 'nosniff'},
        )

    # JSON：仅支持纯 rows 列表（流式回退路径）；pandas 大表只含 matrix，避免 tolist 爆内存
    if result.get('matrix') is not None:
        return jsonify({'error': '该结果仅支持 format=binary，请在请求中加入查询参数 format=binary'}), 400

    try:
        body = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    except (ValueError, TypeError) as e:
        return jsonify({'error': f'结果无法序列化为合法 JSON: {e}'}), 500
    return Response(body, mimetype='application/json; charset=utf-8')


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