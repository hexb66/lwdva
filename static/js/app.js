document.addEventListener('DOMContentLoaded', () => {
    // DOM元素引用
    const fileInput = document.getElementById('file-input');
    const dropArea = document.getElementById('drop-area');
    const delimiterInput = document.getElementById('delimiter');
    const sampleRateInput = document.getElementById('sample-rate');
    const columnList = document.getElementById('column-list');
    const searchBox = document.getElementById('search-box');
    const xAxisSelect = document.getElementById('x-axis-select');
    const normalizeDataCheckbox = document.getElementById('normalize-data');
    const plotDataBtn = document.getElementById('plot-data');
    const clearSelectionBtn = document.getElementById('clear-selection');
    const clearCanvasBtn = document.getElementById('clear-canvas');
    const performFftBtn = document.getElementById('perform-fft');
    const applyFilterBtn = document.getElementById('apply-filter');
    const filterTypeSelect = document.getElementById('filter-type');
    const cutoffFreqInput = document.getElementById('cutoff-freq');
    const cutoffFreq2Container = document.getElementById('cutoff-freq2-container');
    const cutoffFreq2Input = document.getElementById('cutoff-freq2');
    const filterOrderInput = document.getElementById('filter-order');
    const zeroPhaseCheckbox = document.getElementById('zero-phase');
    const loadingElement = document.getElementById('loading');
    const notification = document.getElementById('notification');
    const dataInfo = document.getElementById('data-info');
    
    // 添加列数选择器引用
    const columnCountSelect = document.getElementById('column-count');
    
    // 标签页元素
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // 状态变量
    let csvData = null;
    let headers = [];
    let selectedColumns = new Set(); // 存储选中的Y轴列索引
    let xAxisColumn = -1; // 存储X轴列索引，默认为-1（表示使用序列号）
    
    // 应用数据
    let plotColors = {}; // 存储每列对应的颜色
    
    // 添加文件信息变量
    let currentFileName = '';
    let currentFilePath = '';
    
    // 添加图表容器管理变量
    let plotContainers = []; // 保存所有图表容器的引用
    let currentPlotIndex = -1; // 当前最新图表的索引
    
    // 添加图表计数器用于生成唯一ID
    let plotCounter = 0;
    
    // 标签页切换逻辑
    function switchTab(tabId) {
        // 隐藏所有标签页内容
        tabContents.forEach(content => {
            content.classList.remove('active');
        });
        
        // 移除所有标签按钮的激活状态
        tabButtons.forEach(button => {
            button.classList.remove('active');
        });
        
        // 激活选中的标签页
        document.getElementById(`tab-${tabId}`).classList.add('active');
        
        // 激活对应按钮
        document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
    }
    
    // 为标签按钮添加点击事件
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // 工具函数
    function showLoading() {
        loadingElement.style.display = 'block';
    }
    
    function hideLoading() {
        loadingElement.style.display = 'none';
    }
    
    function showNotification(message, duration = 3000) {
        notification.textContent = message;
        notification.style.display = 'block';
        setTimeout(() => {
            notification.style.display = 'none';
        }, duration);
    }
    
    function getRandomColor() {
        const r = Math.floor(Math.random() * 255);
        const g = Math.floor(Math.random() * 255);
        const b = Math.floor(Math.random() * 255);
        return `rgb(${r}, ${g}, ${b})`;
    }
    
    // 替换随机颜色函数，使用科学出版物常用的配色方案
    function getPlotColor(index) {
        // 学术风格配色方案 - 高对比度、色盲友好
        const academicColors = [
            'rgb(31, 119, 180)',  // 蓝色
            'rgb(255, 127, 14)',  // 橙色
            'rgb(44, 160, 44)',   // 绿色
            'rgb(214, 39, 40)',   // 红色
            'rgb(148, 103, 189)', // 紫色
            'rgb(140, 86, 75)',   // 棕色
            'rgb(227, 119, 194)', // 粉色
            'rgb(127, 127, 127)', // 灰色
            'rgb(188, 189, 34)',  // 黄绿色
            'rgb(23, 190, 207)'   // 青色
        ];
        
        // 循环使用配色方案
        return academicColors[index % academicColors.length];
    }
    
    // 配色初始化 - 替代原来随机生成的颜色
    function initializeColors() {
        plotColors = {};
        headers.forEach((_, index) => {
            plotColors[index] = getPlotColor(index);
        });
    }
    
    // 更新数据信息显示
    function updateDataInfo() {
        if (!csvData || headers.length === 0) {
            dataInfo.innerHTML = '<p>未加载数据</p>';
            return;
        }
        
        let infoHTML = `
            <p><strong>文件信息:</strong></p>
            <p><i class="fas fa-file-alt"></i> 文件名: ${currentFileName}</p>
            <p><i class="fas fa-folder-open"></i> 文件路径: ${currentFilePath}</p>
            <p><i class="fas fa-table"></i> 列数: ${headers.length}</p>
            <p><i class="fas fa-list-ol"></i> 行数: ${csvData.length}</p>
            <p><i class="fas fa-wave-square"></i> 采样频率: ${sampleRateInput.value} Hz</p>
            <p><i class="fas fa-code"></i> 分隔符: "${delimiterInput.value}"</p>
        `;
        
        dataInfo.innerHTML = infoHTML;
        
        // 在导入标签页添加成功提示
        const importTab = document.getElementById('tab-import');
        const successAlert = document.createElement('div');
        successAlert.style.padding = '10px';
        successAlert.style.margin = '10px 0';
        successAlert.style.backgroundColor = '#d4edda';
        successAlert.style.color = '#155724';
        successAlert.style.borderRadius = '4px';
        successAlert.style.border = '1px solid #c3e6cb';
        successAlert.innerHTML = `<i class="fas fa-check-circle"></i> 数据导入成功！`;
        
        // 删除之前的成功提示（如果有）
        const existingAlert = importTab.querySelector('.success-alert');
        if (existingAlert) {
            importTab.removeChild(existingAlert);
        }
        
        // 添加类名以便后续识别
        successAlert.classList.add('success-alert');
        
        // 插入到数据信息区域前面
        const infoPanel = importTab.querySelector('.control-panel:nth-child(2)');
        infoPanel.insertBefore(successAlert, infoPanel.firstChild);
    }
    
    // 数据处理函数
    function handleFiles(file) {
        console.log("处理文件:", file.name); // 调试信息
        showLoading();
        
        // 保存文件信息
        currentFileName = file.name;
        
        // 获取文件路径（由于安全限制，浏览器只提供文件名，不提供完整路径）
        // 如果是通过拖放上传，尝试获取路径
        if (file.path) {
            currentFilePath = file.path;
        } else if (file.webkitRelativePath) {
            currentFilePath = file.webkitRelativePath;
        } else {
            // 浏览器安全限制下通常只能获取文件名
            currentFilePath = '(浏览器限制无法获取完整路径)';
        }
        
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const content = e.target.result;
                const delimiter = delimiterInput.value ? delimiterInput.value.replace(/\\t/g, '\t') : ',';
                const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
                
                if (lines.length === 0) {
                    throw new Error('文件为空');
                }
                
                headers = lines[0].split(delimiter).map(h => h.trim());
                
                // 处理数据行 - 确保数据类型为数值
                csvData = [];
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(delimiter).map(x => {
                        // 强制转换为数值
                        return parseFloat(x) || 0;
                    });
                    
                    // 确保每行的数据列数一致
                    if (values.length === headers.length) {
                        csvData.push(values);
                    }
                }
                
                // 打印数据样本以便调试
                console.log("数据样本:", {
                    headers: headers,
                    firstRow: csvData[0],
                    rowCount: csvData.length
                });
                
                // 重置状态
                selectedColumns.clear();
                xAxisColumn = -1; // 重置为默认序列号
                
                // 使用固定学术配色，替代随机颜色
                initializeColors();
                
                // 更新UI
                updateXAxisSelect(); // 添加X轴下拉菜单更新
                renderColumnList();
                updateDataInfo(); // 现在会显示文件路径
                showNotification(`成功导入数据: ${headers.length} 列, ${csvData.length} 行`);
                
                // 不自动切换标签页，让用户看到导入信息
                // switchTab('select');
            } catch (error) {
                showNotification(`错误: ${error.message}`, 5000);
                console.error(error);
            } finally {
                hideLoading();
            }
        };
        
        reader.onerror = () => {
            hideLoading();
            showNotification('读取文件时发生错误', 5000);
        };
        
        reader.readAsText(file);
    }
    
    // 更新X轴下拉菜单
    function updateXAxisSelect() {
        // 清除已有选项（保留默认选项）
        while (xAxisSelect.options.length > 1) {
            xAxisSelect.remove(1);
        }
        
        // 添加所有列作为X轴选项
        headers.forEach((header, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = header;
            xAxisSelect.appendChild(option);
        });
        
        // 设置默认选中值
        xAxisSelect.value = xAxisColumn;
    }
    
    // 修改renderColumnList函数，移除颜色色块
    function renderColumnList() {
        columnList.innerHTML = '';
        
        headers.forEach((col, index) => {
            const li = document.createElement('li');
            
            // 创建checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `col-${index}`;
            checkbox.checked = selectedColumns.has(index);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedColumns.add(index);
                } else {
                    selectedColumns.delete(index);
                }
            });
            
            // 创建标签 - 紧凑布局
            const label = document.createElement('label');
            label.htmlFor = `col-${index}`;
            label.textContent = col;
            label.style.marginLeft = '5px';
            label.style.cursor = 'pointer';
            label.style.fontSize = '0.9em'; // 略微减小字体以更紧凑
            
            li.appendChild(checkbox);
            li.appendChild(label);
            
            // 过滤搜索结果
            const query = searchBox.value.trim().toLowerCase();
            if (query && !col.toLowerCase().includes(query)) {
                li.style.display = 'none';
            }
            
            columnList.appendChild(li);
        });
    }
    
    // 修改计入搜索框过滤逻辑
    searchBox.addEventListener('input', () => {
        const query = searchBox.value.trim().toLowerCase();
        const items = columnList.getElementsByTagName('li');
        Array.from(items).forEach(item => {
            const label = item.querySelector('label');
            item.style.display = label.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
    });
    
    // 创建图表容器函数 - 完全重写，恢复基础功能
    function createPlotContainer(title) {
        // 创建容器
        const plotContainer = document.createElement('div');
        plotContainer.className = 'plot-container';
        
        // 创建标题栏
        const header = document.createElement('div');
        header.className = 'plot-header';
        
        // 添加标题
        const titleElem = document.createElement('div');
        titleElem.className = 'plot-title';
        titleElem.textContent = title || '数据曲线';
        
        // 添加控制按钮
        const controls = document.createElement('div');
        controls.className = 'plot-controls';
        
        // 最小化按钮
        const minimizeBtn = document.createElement('button');
        minimizeBtn.className = 'plot-control-btn minimize';
        minimizeBtn.innerHTML = '<i class="fas fa-window-minimize"></i>';
        minimizeBtn.title = '最小化';
        minimizeBtn.onclick = () => {
            plotContainer.classList.toggle('minimized');
            // 更新按钮图标
            if (plotContainer.classList.contains('minimized')) {
                minimizeBtn.innerHTML = '<i class="fas fa-window-maximize"></i>';
                minimizeBtn.title = '恢复';
            } else {
                minimizeBtn.innerHTML = '<i class="fas fa-window-minimize"></i>';
                minimizeBtn.title = '最小化';
            }
        };
        
        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.className = 'plot-control-btn close';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.title = '关闭';
        closeBtn.onclick = () => {
            // 清除图表资源
            try {
                if (plotBody._fullLayout) {
                    Plotly.purge(plotBody);
                }
            } catch (e) {
                console.error("清除图表资源时发生错误:", e);
            }
            
            // 从DOM中移除
            plotContainer.remove();
            
            // 从数组中移除
            const index = plotContainers.indexOf(plotContainer);
            if (index > -1) {
                plotContainers.splice(index, 1);
            }
        };
        
        // 添加按钮到控制区
        controls.appendChild(minimizeBtn);
        controls.appendChild(closeBtn);
        
        // 组装标题栏
        header.appendChild(titleElem);
        header.appendChild(controls);
        
        // 创建图表主体区域 - 直接使用div
        const plotBody = document.createElement('div');
        plotBody.className = 'plot-body';
        plotBody.style.height = '400px';
        plotBody.style.width = '100%';
        plotBody.style.position = 'relative'; // 确保Plotly可以正确定位
        
        // 组装容器
        plotContainer.appendChild(header);
        plotContainer.appendChild(plotBody);
        
        return { 
            container: plotContainer, 
            body: plotBody, 
            title: titleElem 
        };
    }
    
    // 简化版的绘图函数
    function plotSelectedData() {
        if (!csvData || csvData.length === 0 || selectedColumns.size === 0) {
            showNotification('请选择至少一个Y轴数据列');
            return;
        }

        const plotAreaElem = document.getElementById('plot-area-container');
        const placeholder = document.getElementById('plot-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // 准备数据
        const shouldNormalize = normalizeDataCheckbox.checked;
        const xValues = getXAxisValues();
        const traces = getTraces(xValues, shouldNormalize);
        const plotTitle = getPlotTitle(shouldNormalize);

        // 获取绘图模式：new、overwrite 或 append
        const mode = document.querySelector('input[name="plot-mode"]:checked').value;

        // 声明目标容器和绘图主体
        let targetContainer, plotBody;

        // 根据模式创建或获取绘图容器
        if (mode === 'new' || plotAreaElem.children.length === 0) {
            // 创建新容器，并添加到最前面
            const { container, body } = createPlotContainer(plotTitle);
            targetContainer = container;
            plotBody = body;
            plotAreaElem.insertBefore(targetContainer, plotAreaElem.firstChild);
        } else if (mode === 'overwrite') {
            // 创建新容器并替换第一个图表
            const { container, body } = createPlotContainer(plotTitle);
            targetContainer = container;
            plotBody = body;
            plotAreaElem.replaceChild(targetContainer, plotAreaElem.children[0]);
        } else if (mode === 'append') {
            // 使用已有图表容器
            targetContainer = plotAreaElem.children[0];
            // 从已有容器中找到绘图主体
            plotBody = targetContainer.querySelector('.plot-body');
        }

        // 定义图表布局 - 使用学术风格并添加边框
        const layout = {
            title: plotTitle,
            xaxis: { 
                title: xAxisColumn >= 0 ? headers[xAxisColumn] : '数据索引',
                gridcolor: '#E0E0E0',
                zerolinecolor: '#000000',
                tickfont: { size: 11 },
                linecolor: '#000',  // 添加x轴线颜色
                linewidth: 1,       // 添加x轴线宽度
                mirror: true        // 使顶部也显示轴线
            },
            yaxis: { 
                title: getYAxisTitle(shouldNormalize),
                gridcolor: '#E0E0E0',
                zerolinecolor: '#000000',
                tickfont: { size: 11 },
                linecolor: '#000',  // 添加y轴线颜色
                linewidth: 1,       // 添加y轴线宽度
                mirror: true        // 使右侧也显示轴线
            },
            showlegend: true,
            legend: {
                x: 1.02,
                y: 1,
                xanchor: 'left',
                font: { size: 11 },
                bordercolor: '#000',    // 添加图例边框
                borderwidth: 1          // 图例边框宽度
            },
            margin: { l: 60, r: 50, t: 50, b: 60 },
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            font: { family: 'Arial, sans-serif' },
            shapes: [{  // 添加整体图表边框
                type: 'rect',
                xref: 'paper',
                yref: 'paper',
                x0: 0,
                y0: 0,
                x1: 1,
                y1: 1,
                line: {
                    color: '#000',
                    width: 1
                }
            }]
        };

        // 学术风格的绘图配置
        const config = { 
            responsive: true,
            displayModeBar: true,
            toImageButtonOptions: {
                format: 'svg',  // 导出矢量图格式，适合学术出版
                filename: plotTitle,
                height: 600,
                width: 800,
                scale: 1
            }
        };

        setTimeout(() => {
            // 绘图操作
            try {
                if (mode === 'append' && targetContainer._fullLayout) {
                    // 附加模式下，添加新数据到已有图表
                    Plotly.addTraces(plotBody, traces);
                } else {
                    // 新建或覆盖模式下，绘制新的图表
                    Plotly.newPlot(plotBody, traces, layout, config);
                }
                showNotification('绘图成功');
            } catch (err) {
                console.error("绘图失败:", err);
                showNotification('绘图失败: ' + err.message);
                displayError(plotAreaElem, err, xValues, traces);
            }
        }, 50);
    }
    
    // 获取X轴数据
    function getXAxisValues() {
        if (xAxisColumn >= 0) {
            return csvData.map(row => parseFloat(row[xAxisColumn]) || 0);
        } else {
            return Array.from({ length: csvData.length }, (_, i) => i + 1);
        }
    }
    
    // 获取Y轴数据
    function getTraces(xValues, shouldNormalize) {
        const traces = [];
        const normalizationMethod = normalizationMethodSelect.value;
        
        selectedColumns.forEach(colIndex => {
            let yValues = csvData.map(row => parseFloat(row[colIndex]) || 0);
            
            if (shouldNormalize) {
                yValues = normalizeData(yValues, normalizationMethod);
            }
            
            traces.push({
                x: xValues,
                y: yValues,
                mode: 'lines',
                name: headers[colIndex] + (shouldNormalize ? ` (${getNormalizationLabel(normalizationMethod)})` : ''),
                line: { color: plotColors[colIndex] }
            });
        });
        
        return traces;
    }
    
    // 获取图表标题
    function getPlotTitle(shouldNormalize) {
        if (selectedColumns.size === 1) {
            const colIndex = selectedColumns.values().next().value;
            return headers[colIndex] + (shouldNormalize ? ` (${getNormalizationLabel(normalizationMethodSelect.value)})` : '');
        } else if (xAxisColumn >= 0) {
            return `多系列数据 - X轴: ${headers[xAxisColumn]}`;
        } else {
            return '数据曲线';
        }
    }
    
    // 显示错误信息
    function displayError(container, error, xValues, traces) {
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '20px';
        errorDiv.style.border = '1px solid red';
        errorDiv.textContent = '绘图错误: ' + error.message;
        container.appendChild(errorDiv);
        
        // 显示数据信息用于调试
        const dataInfoDiv = document.createElement('pre');
        dataInfoDiv.style.backgroundColor = '#f5f5f5';
        dataInfoDiv.style.padding = '10px';
        dataInfoDiv.style.maxHeight = '200px';
        dataInfoDiv.style.overflow = 'auto';
        dataInfoDiv.textContent = JSON.stringify({
            xLength: xValues.length,
            yLength: traces[0]?.y.length || 0,
            sampleX: xValues.slice(0, 5),
            sampleY: traces[0]?.y.slice(0, 5)
        }, null, 2);
        container.appendChild(dataInfoDiv);
    }
    
    // 清除所有图表
    function clearAllPlots() {
        const container = document.getElementById('plot-area-container');
        container.innerHTML = '';
        
        // 添加占位提示
        const placeholder = document.createElement('div');
        placeholder.id = 'plot-placeholder';
        placeholder.style.padding = '20px';
        placeholder.style.textAlign = 'center';
        placeholder.style.color = '#666';
        placeholder.textContent = '选择数据后点击"绘制数据"按钮来生成图表';
        container.appendChild(placeholder);
        
        showNotification('已清除所有图表');
    }
    
    // 修改为支持多个数据的频谱分析
    function performFFT() {
        // 找到选中的checkbox
        const checkedInputs = columnList.querySelectorAll('input[type="checkbox"]:checked');
        
        if (checkedInputs.length === 0) {
            showNotification('请至少选择一个列进行频谱分析');
            return;
        }
        
        // 获取所有选中的列索引和数据
        const selectedIndices = Array.from(checkedInputs).map(input => 
            parseInt(input.id.replace('col-', ''))
        );
        
        const dataArray = selectedIndices.map(colIndex => 
            csvData.map(row => row[colIndex])
        );
        
        const names = selectedIndices.map(colIndex => headers[colIndex]);
        const sampleRate = parseFloat(sampleRateInput.value) || 1000;
        
        showLoading();
        fetch('/api/fft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                data: dataArray, 
                names: names,
                sample_rate: sampleRate 
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('服务器响应错误');
            }
            return response.json();
        })
        .then(result => {
            // 检查是否是多组数据结果
            if (result.series) {
                // 处理多组数据结果
                const traces = [];
                
                // 对每个数据系列处理
                result.series.forEach((series, index) => {
                    // 只保留频谱的一半（正频率部分）
                    const frequencies = series.frequencies.slice(0, Math.floor(series.frequencies.length / 2));
                    const magnitudes = series.magnitude.slice(0, Math.floor(series.magnitude.length / 2));
                    
                    traces.push({
                        x: frequencies,
                        y: magnitudes,
                        mode: 'lines',
                        name: `${series.name} 的频谱`,
                        line: { 
                            color: getPlotColor(selectedIndices[index]), 
                            width: 1.5 
                        }
                    });
                });
                
                // 学术风格布局
                const layout = {
                    title: selectedIndices.length === 1 
                        ? `频谱分析 - ${names[0]}`
                        : '多数据频谱分析',
                    xaxis: { 
                        title: '频率 (Hz)',
                        gridcolor: '#E0E0E0',
                        zerolinecolor: '#000000',
                        automargin: true,
                        tickfont: { size: 11 },
                        linecolor: '#000',
                        linewidth: 1,
                        mirror: true
                    },
                    yaxis: { 
                        title: '幅值',
                        gridcolor: '#E0E0E0',
                        zerolinecolor: '#000000',
                        automargin: true,
                        tickfont: { size: 11 },
                        linecolor: '#000',
                        linewidth: 1,
                        mirror: true
                    },
                    margin: { t: 50, l: 60, r: 50, b: 60 },
                    font: { family: 'Arial, sans-serif', size: 12 },
                    paper_bgcolor: 'white',
                    plot_bgcolor: 'white',
                    showlegend: true,
                    legend: {
                        x: 1.02,
                        y: 1,
                        xanchor: 'left',
                        font: { size: 11 },
                        bordercolor: '#000',
                        borderwidth: 1
                    },
                    shapes: [{
                        type: 'rect',
                        xref: 'paper',
                        yref: 'paper',
                        x0: 0,
                        y0: 0,
                        x1: 1,
                        y1: 1,
                        line: {
                            color: '#000',
                            width: 1
                        }
                    }]
                };
                
                // 学术导出设置
                const config = { 
                    responsive: true,
                    displaylogo: false,
                    toImageButtonOptions: {
                        format: 'svg',  // 矢量格式适合出版
                        filename: `频谱分析_${new Date().toISOString().split('T')[0]}`,
                        height: 600,
                        width: 800,
                        scale: 1
                    }
                };
                
                try {
                    // 创建新容器
                    const { container, body, title } = createPlotContainer(
                        selectedIndices.length === 1 
                        ? `频谱分析 - ${names[0]}` 
                        : '多数据频谱分析'
                    );
                    
                    // 添加到DOM
                    const plotAreaElem = document.getElementById('plot-area-container');
                    if (plotAreaElem.firstChild) {
                        plotAreaElem.insertBefore(container, plotAreaElem.firstChild);
                    } else {
                        plotAreaElem.appendChild(container);
                    }
                    
                    // 绘图
                    console.log("绘制频谱图:", { series: result.series.length });
                    Plotly.newPlot(body, traces, layout, config)
                        .then(() => {
                            console.log("频谱图绘制成功");
                            plotContainers.unshift(container);
                        })
                        .catch(err => console.error("频谱图绘制失败:", err));
                    
                    showNotification('频谱分析完成');
                } catch (err) {
                    console.error("频谱分析绘图错误:", err);
                    showNotification('频谱分析绘图出错');
                }
            } else {
                // 向后兼容处理单组数据结果
                // ...existing single data processing code...
            }
        })
        .catch(error => {
            showNotification(`错误: ${error.message}`, 5000);
            console.error(error);
        })
        .finally(() => {
            hideLoading();
        });
    }
    
    // 修改为支持多个数据的滤波处理
    function applyFilter() {
        // 找到选中的checkbox
        const checkedInputs = columnList.querySelectorAll('input[type="checkbox"]:checked');
        
        if (checkedInputs.length === 0) {
            showNotification('请至少选择一个列进行滤波');
            return;
        }
        
        // 获取所有选中的列索引和数据
        const selectedIndices = Array.from(checkedInputs).map(input => 
            parseInt(input.id.replace('col-', ''))
        );
        
        const dataArray = selectedIndices.map(colIndex => 
            csvData.map(row => row[colIndex])
        );
        
        const names = selectedIndices.map(colIndex => headers[colIndex]);
        const sampleRate = parseFloat(sampleRateInput.value) || 1000;
        const filterType = filterTypeSelect.value;
        
        if (filterType === 'none') {
            showNotification('请选择滤波器类型');
            return;
        }
        
        const cutoffFreq = parseFloat(cutoffFreqInput.value);
        const cutoffFreq2 = parseFloat(cutoffFreq2Input.value);
        const filterOrder = parseInt(filterOrderInput.value);
        const zeroPhase = zeroPhaseCheckbox.checked;
        
        // 组装请求数据
        const requestData = {
            data: dataArray,
            names: names,
            sample_rate: sampleRate,
            filter_type: filterType,
            cutoff_freq: cutoffFreq,
            cutoff_freq2: cutoffFreq2,
            filter_order: filterOrder,
            zero_phase: zeroPhase
        };
        
        showLoading();
        fetch('/api/filter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('服务器响应错误');
            }
            return response.json();
        })
        .then(result => {
            // 获取X轴数据
            let xValues;
            if (xAxisColumn >= 0) {
                xValues = csvData.map(row => row[xAxisColumn]);
            } else {
                xValues = Array.from({ length: csvData.length }, (_, i) => i + 1);
            }
            
            try {
                if (result.series) {
                    // 处理多组数据结果
                    // 创建容器标题
                    const containerTitle = selectedIndices.length === 1 
                        ? `滤波处理 - ${names[0]}`
                        : '多数据滤波处理';
                        
                    // 创建新容器
                    const { container, body, title } = createPlotContainer(containerTitle);
                    
                    // 创建多组数据的轨迹
                    const traces = [];
                    
                    // 对每个数据系列处理，添加原始数据和滤波后的数据
                    result.series.forEach((series, index) => {
                        const baseColor = getPlotColor(selectedIndices[index]);
                        
                        // 添加原始数据 - 用实线
                        traces.push({
                            x: xValues,
                            y: dataArray[index],
                            mode: 'lines',
                            name: `${series.name} (原始)`,
                            line: { 
                                color: baseColor,
                                width: 1.5 
                            }
                        });
                        
                        // 将颜色转换为HSL格式并修改色调以产生明显的差异
                        // 提取RGB值以便转换为HSL
                        let rgbMatch = baseColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        let r, g, b;
                        
                        if (rgbMatch) {
                            r = parseInt(rgbMatch[1]);
                            g = parseInt(rgbMatch[2]);
                            b = parseInt(rgbMatch[3]);
                        } else {
                            // 默认颜色如果无法解析
                            r = 0; g = 100; b = 200;
                        }
                        
                        // 将RGB转换为HSL
                        r /= 255, g /= 255, b /= 255;
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        let h, s, l = (max + min) / 2;
                        
                        if (max === min) {
                            h = s = 0; // 灰色
                        } else {
                            const d = max - min;
                            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                            switch (max) {
                                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                                case g: h = (b - r) / d + 2; break;
                                case b: h = (r - g) / d + 4; break;
                            }
                            h /= 6;
                        }
                        
                        // 修改色调以创建对比色 - 在色环上移动120度
                        h = (h + 0.33) % 1;
                        
                        // 转换回RGB
                        let r2, g2, b2;
                        if (s === 0) {
                            r2 = g2 = b2 = l; // 灰色
                        } else {
                            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                            const p = 2 * l - q;
                            r2 = hueToRgb(p, q, h + 1/3);
                            g2 = hueToRgb(p, q, h);
                            b2 = hueToRgb(p, q, h - 1/3);
                        }
                        
                        const filteredColor = `rgb(${Math.round(r2 * 255)}, ${Math.round(g2 * 255)}, ${Math.round(b2 * 255)})`;
                        
                        // 添加滤波后的数据 - 不同色调和虚线
                        traces.push({
                            x: xValues,
                            y: series.filtered_data,
                            mode: 'lines',
                            name: `${series.name} (滤波后)`,
                            line: { 
                                color: filteredColor,
                                width: 2,
                                dash: 'dash' // 使用虚线表示滤波后数据
                            }
                        });
                    });
                    
                    // 学术风格布局
                    const layout = {
                        title: containerTitle,
                        xaxis: {
                            title: xAxisColumn >= 0 ? headers[xAxisColumn] : '数据索引',
                            gridcolor: '#E0E0E0',
                            zerolinecolor: '#000000',
                            automargin: true,
                            tickfont: { size: 11 },
                            linecolor: '#000',
                            linewidth: 1,
                            mirror: true
                        },
                        yaxis: { 
                            title: '数值',
                            gridcolor: '#E0E0E0',
                            zerolinecolor: '#000000',
                            automargin: true,
                            tickfont: { size: 11 },
                            linecolor: '#000',
                            linewidth: 1,
                            mirror: true
                        },
                        margin: { t: 50, l: 60, r: 50, b: 60 },
                        font: { family: 'Arial, sans-serif', size: 12 },
                        paper_bgcolor: 'white',
                        plot_bgcolor: 'white',
                        showlegend: true,
                        legend: {
                            font: { size: 11 },
                            x: 1.02,
                            xanchor: 'left',
                            y: 1,
                            bordercolor: '#000',
                            borderwidth: 1
                        },
                        shapes: [{
                            type: 'rect',
                            xref: 'paper',
                            yref: 'paper',
                            x0: 0,
                            y0: 0,
                            x1: 1,
                            y1: 1,
                            line: {
                                color: '#000',
                                width: 1
                            }
                        }]
                    };
                    
                    // 学术导出配置
                    const config = { 
                        responsive: true,
                        displaylogo: false,
                        toImageButtonOptions: {
                            format: 'svg',
                            filename: `滤波_${new Date().toISOString().split('T')[0]}`,
                            height: 600,
                            width: 800,
                            scale: 1
                        }
                    };
                    
                    // 添加到DOM
                    const plotAreaElem = document.getElementById('plot-area-container');
                    if (plotAreaElem.firstChild) {
                        plotAreaElem.insertBefore(container, plotAreaElem.firstChild);
                    } else {
                        plotAreaElem.appendChild(container);
                    }
                    
                    // 绘图
                    console.log("绘制滤波图:", { series: result.series.length });
                    Plotly.newPlot(body, traces, layout, config)
                        .then(() => {
                            console.log("滤波图绘制成功");
                            plotContainers.unshift(container);
                        })
                        .catch(err => console.error("滤波图绘制失败:", err));
                    
                    showNotification('滤波处理完成');
                } else {
                    // 向后兼容处理单组数据结果
                    // ...existing single data processing code...
                }
            } catch (err) {
                console.error("滤波处理绘图错误:", err);
                showNotification('滤波处理绘图出错');
            }
        })
        .catch(error => {
            showNotification(`错误: ${error.message}`, 5000);
            console.error(error);
        })
        .finally(() => {
            hideLoading();
        });
    }
    
    // 添加辅助函数用于HSL到RGB转换
    function hueToRgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    }
    
    // 事件绑定 - 特别关注文件读取功能
    fileInput.addEventListener('change', e => {
        console.log("文件选择变化", e.target.files); // 调试信息
        if (e.target.files.length) {
            handleFiles(e.target.files[0]);
            // 确保用户看到导入标签页
            switchTab('import');
        }
    });
    
    // 修复拖放功能
    dropArea.addEventListener('dragover', e => {
        e.preventDefault(); // 必须阻止默认行为
        e.stopPropagation();
        dropArea.style.borderColor = 'var(--primary-color)';
        dropArea.style.backgroundColor = '#e8f4fd';
    });
    
    dropArea.addEventListener('dragleave', e => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.style.borderColor = '#ccc';
        dropArea.style.backgroundColor = 'var(--light-bg)';
    });
    
    dropArea.addEventListener('drop', e => {
        console.log("文件拖放", e.dataTransfer.files); // 调试信息
        e.preventDefault(); // 必须阻止默认行为
        e.stopPropagation();
        dropArea.style.borderColor = '#ccc';
        dropArea.style.backgroundColor = 'var(--light-bg)';
        if (e.dataTransfer.files.length) {
            handleFiles(e.dataTransfer.files[0]);
            // 确保用户看到导入标签页
            switchTab('import');
        }
    });
    
    searchBox.addEventListener('input', () => {
        const query = searchBox.value.trim().toLowerCase();
        const items = columnList.getElementsByTagName('li');
        Array.from(items).forEach(item => {
            const label = item.querySelector('label');
            item.style.display = label.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
    });
    
    clearSelectionBtn.addEventListener('click', () => {
        selectedColumns.clear();
        // 更新所有checkbox状态
        const checkboxes = columnList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        renderColumnList();
    });
    
    clearCanvasBtn.addEventListener('click', () => {
        clearAllPlots();
    });
    
    performFftBtn.addEventListener('click', () => {
        performFFT();
        // 确保用户看到执行结果
        switchTab('analyze');
    });
    
    applyFilterBtn.addEventListener('click', () => {
        applyFilter();
        // 确保用户看到执行结果
        switchTab('analyze');
    });
    
    // 当选择带通或带阻时显示第二个截止频率输入框
    filterTypeSelect.addEventListener('change', () => {
        if (filterTypeSelect.value === 'bandpass' || filterTypeSelect.value === 'bandstop') {
            cutoffFreq2Container.style.display = 'flex';
        } else {
            cutoffFreq2Container.style.display = 'none';
        }
    });
    
    // 添加X轴选择事件处理
    xAxisSelect.addEventListener('change', () => {
        xAxisColumn = parseInt(xAxisSelect.value);
    });
    
    // 添加绘制数据按钮事件处理
    plotDataBtn.addEventListener('click', () => {
        plotSelectedData();
    });
    
    // 移除原有的自动绘图逻辑，由绘制按钮触发
    console.log("JavaScript初始化完成"); // 调试信息

    // 添加DOM元素引用
    const normalizationMethodSelect = document.getElementById('normalization-method');

    // 当用户勾选/取消勾选归一化选项时，直接控制select元素的显示/隐藏
    normalizeDataCheckbox.addEventListener('change', () => {
        normalizationMethodSelect.style.display = normalizeDataCheckbox.checked ? 'block' : 'none';
    });

    // 添加归一化数据处理函数
    function normalizeData(data, method) {
        switch (method) {
            case 'minmax': {
                // Min-Max归一化 (0-1)
                const minVal = Math.min(...data);
                const maxVal = Math.max(...data);
                const range = maxVal - minVal;
                
                if (range === 0) return data;
                return data.map(y => (y - minVal) / range);
            }
            
            case 'zscore': {
                // Z-Score标准化 (均值=0, 标准差=1)
                const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
                const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
                const stdDev = Math.sqrt(variance);
                
                if (stdDev === 0) return data.map(() => 0);
                return data.map(y => (y - mean) / stdDev);
            }
            
            case 'maxabs': {
                // 最大绝对值缩放
                const maxAbs = Math.max(...data.map(Math.abs));
                
                if (maxAbs === 0) return data;
                return data.map(y => y / maxAbs);
            }
            
            case 'robust': {
                // 健壮缩放 (基于中位数和四分位距)
                const sorted = [...data].sort((a, b) => a - b);
                const median = sorted[Math.floor(sorted.length / 2)];
                const q1 = sorted[Math.floor(sorted.length / 4)];
                const q3 = sorted[Math.floor(3 * sorted.length / 4)];
                const iqr = q3 - q1;
                
                if (iqr === 0) return data.map(y => y - median);
                return data.map(y => (y - median) / iqr);
            }
            
            case 'log': {
                // 对数变换 (处理负值和零值)
                const minVal = Math.min(...data);
                // 如果有负值或零值，添加偏移量使最小值为1
                const offset = minVal < 1 ? 1 - minVal : 0;
                
                return data.map(y => Math.log(y + offset));
            }
            
            case 'sqrt': {
                // 平方根变换 (处理负值)
                const minVal = Math.min(...data);
                // 如果有负值，添加偏移量使最小值为0
                const offset = minVal < 0 ? -minVal : 0;
                
                return data.map(y => Math.sqrt(y + offset));
            }
            
            default:
                return data;
        }
    }

    // 获取归一化方法的描述标签
    function getNormalizationLabel(method) {
        const labels = {
            'minmax': '归一化0-1',
            'zscore': 'Z-score',
            'maxabs': '最大绝对值',
            'robust': '健壮缩放',
            'log': '对数变换',
            'sqrt': '平方根变换'
        };
        
        return labels[method] || '归一化';
    }

    // 修改布局显示信息
    function getYAxisTitle(shouldNormalize) {
        if (!shouldNormalize) return '数值';
        
        const method = normalizationMethodSelect.value;
        switch (method) {
            case 'minmax': return '归一化数值 (0-1)';
            case 'zscore': return '标准化数值 (Z-Score)';
            case 'maxabs': return '缩放数值 (最大绝对值)';
            case 'robust': return '健壮缩放数值';
            case 'log': return '对数变换值';
            case 'sqrt': return '平方根变换值';
            default: return '归一化数值';
        }
    }
});