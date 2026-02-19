// ==================== Configuration ====================
const CONFIG = {
    center: [-22.6444, -43.6517], // Japeri coordinates [lat, lng] (Approximate center)
    zoom: 12,
    minZoom: 10,
    maxZoom: 18,
    basemaps: {
        streets: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors'
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '© Esri'
        },
        terrain: {
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors'
        }
    },
    layers: {
        bairros: {
            file: 'data/bairros_jap.geojson',
            color: '#667eea',
            name: 'Bairros'
        },
        setores: {
            file: 'data/setores1_jap.geojson',
            color: '#f093fb',
            name: 'Setores Censitários'
        },
        urb_rur: {
            file: 'data/urb_rur_jap.geojson',
            color: '#4facfe',
            name: 'Urbano / Rural'
        },
        deficit_hab: {
            file: 'data/deficit_hab_jap.geojson',
            color: '#fa709a',
            name: 'Déficit Habitacional'
        },
        residencia: {
            file: 'data/residencias_jap.geojson',
            color: '#43e97b',
            name: 'Residências'
        }
    }
};

// ==================== Global Variables ====================
let map;
let currentBasemap = 'streets';
let basemapLayers = {};
let dataLayers = {};
let loadingIndicator;
let selectedAttributes = new Set(['CD_SETOR', 'NM_MUN', 'NM_DIST', 'AREA_KM2', 'v0001', 'v0002', 'v0007']);

// ==================== Initialize Map ====================
function initMap() {
    // Create map
    map = L.map('map', {
        center: CONFIG.center,
        zoom: CONFIG.zoom,
        minZoom: CONFIG.minZoom,
        maxZoom: CONFIG.maxZoom,
        zoomControl: false,
        attributionControl: true
    });

    // Add initial basemap
    addBasemap('streets');

    // Load data layers
    loadDataLayers();

    // Setup event listeners
    setupEventListeners();
}

// ==================== Basemap Management ====================
function addBasemap(basemapName) {
    // Remove existing basemap
    if (basemapLayers[currentBasemap]) {
        map.removeLayer(basemapLayers[currentBasemap]);
    }

    // Add new basemap
    if (!basemapLayers[basemapName]) {
        const config = CONFIG.basemaps[basemapName];
        basemapLayers[basemapName] = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: CONFIG.maxZoom
        });
    }

    basemapLayers[basemapName].addTo(map);
    currentBasemap = basemapName;

    // Update UI
    document.querySelectorAll('.basemap-option').forEach(option => {
        option.classList.remove('active');
    });
    document.querySelector(`[data-basemap="${basemapName}"]`).classList.add('active');
}

// ==================== Data Layer Management ====================
async function loadDataLayers() {
    showLoading();

    try {
        // Load bairros layer by default
        await loadLayer('bairros');
        hideLoading();
    } catch (error) {
        console.error('Error loading initial layers:', error);
        hideLoading();
        alert('Erro ao carregar camadas. Verifique o console para mais detalhes.');
    }
}

async function loadLayer(layerName) {
    if (dataLayers[layerName]) {
        return; // Already loaded
    }

    try {
        const config = CONFIG.layers[layerName];
        console.log(`Loading layer: ${layerName} from ${config.file}`);

        const response = await fetch(config.file);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const geojsonData = await response.json();
        console.log(`Layer ${layerName} loaded successfully with ${geojsonData.features?.length || 0} features`);

        // Check if coordinates need reprojection (for deficit_hab layer)
        if (layerName === 'deficit_hab' && geojsonData.features.length > 0) {
            const firstCoord = geojsonData.features[0].geometry.coordinates[0][0][0];

            // If coordinates are very large (> 180), they're likely in UTM projection
            if (Math.abs(firstCoord[0]) > 180) {
                console.log('Reprojecting deficit_hab coordinates from UTM to WGS84...');

                // Define UTM Zone 23S projection (EPSG:31983 - SIRGAS 2000)
                proj4.defs("EPSG:31983", "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

                // Reproject all coordinates
                geojsonData.features.forEach(feature => {
                    if (feature.geometry.type === 'MultiPolygon') {
                        feature.geometry.coordinates = feature.geometry.coordinates.map(polygon =>
                            polygon.map(ring =>
                                ring.map(coord => {
                                    const [lng, lat] = proj4('EPSG:31983', 'EPSG:4326', coord);
                                    return [lng, lat];
                                })
                            )
                        );
                    } else if (feature.geometry.type === 'Polygon') {
                        feature.geometry.coordinates = feature.geometry.coordinates.map(ring =>
                            ring.map(coord => {
                                const [lng, lat] = proj4('EPSG:31983', 'EPSG:4326', coord);
                                return [lng, lat];
                            })
                        );
                    }
                });

                console.log('Reprojection complete!');
            }
        }

        const layer = L.geoJSON(geojsonData, {
            style: feature => getFeatureStyle(feature, config.color),
            pointToLayer: (feature, latlng) => {
                // For point geometries (like residencias), create circle markers
                return L.circleMarker(latlng, {
                    radius: 6,
                    fillColor: config.color,
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.7
                });
            },
            onEachFeature: (feature, layer) => {
                layer.on({
                    mouseover: highlightFeatureFixed,
                    mouseout: resetHighlight,
                    click: showFeatureInfo
                });

                // Add permanent label for bairros (neighborhoods)
                if (layerName === 'bairros' && feature.properties.NM_BAIRRO) {
                    const label = feature.properties.NM_BAIRRO;
                    layer.bindTooltip(label, {
                        permanent: true,
                        direction: 'center',
                        className: 'neighborhood-label'
                    });
                }
            }
        });

        dataLayers[layerName] = layer;

        // Apply black borders to bairros layer
        if (layerName === 'bairros') {
            layer.eachLayer(feature => {
                feature.setStyle({
                    color: '#000000',  // Black borders
                    weight: 2
                });
            });
        }

        // Add to map if checkbox is checked
        const checkbox = document.getElementById(`layer-${layerName}`);
        if (checkbox && checkbox.checked) {
            layer.addTo(map);
            console.log(`Layer ${layerName} added to map`);
        }

        return layer;
    } catch (error) {
        console.error(`Error loading layer ${layerName}:`, error);
        alert(`Erro ao carregar camada ${layerName}: ${error.message}\n\nVerifique se o arquivo ${CONFIG.layers[layerName].file} existe.`);
        throw error;
    }
}

function getFeatureStyle(feature, color) {
    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: color,
        dashArray: '',
        fillOpacity: 0.3
    };
}

function highlightFeatureFixed(e) {
    const layer = e.target;
    const currentFillColor = layer.options.fillColor;
    const currentFillOpacity = layer.options.fillOpacity;

    if (layer instanceof L.CircleMarker) {
        layer.setStyle({
            radius: 8,
            weight: 3,
            color: '#ffffff',
            fillOpacity: currentFillOpacity,
            fillColor: currentFillColor
        });
    } else {
        const style = {
            weight: 3,
            color: '#ffffff',
            dashArray: '',
            fillOpacity: currentFillOpacity // Mantém a opacidade original
        };

        layer.setStyle(style);
        layer.bringToFront();
    }
}

function resetHighlight(e) {
        const layer = e.target;
        const layerName = getLayerName(layer);

        // Check if it's a circle marker (point)
        const isCircleMarker = layer instanceof L.CircleMarker;

        // If thematic mapping is active, restore thematic color
        if (currentThematicAttribute && layerName === 'setores') {
            const value = layer.feature.properties[currentThematicAttribute];
            const color = getColorForValue(value, thematicBreaks, thematicColors);

            layer.setStyle({
                fillColor: color,
                weight: 1,
                opacity: 1,
                color: '#000000',
                fillOpacity: 0.7
            });
        } else {
            // Otherwise, restore original style
            const config = CONFIG.layers[layerName];
            if (config) {
                if (isCircleMarker) {
                    layer.setStyle({
                        radius: 6,
                        fillColor: config.color,
                        color: '#ffffff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.7
                    });
                } else {
                    layer.setStyle(getFeatureStyle(layer.feature, config.color));
                    if (layerName === 'bairros') {
                        layer.setStyle({
                            color: '#000000',  // Restore black border
                            weight: 2
                        });
                    }
                }
            }
        }
    }

    function getLayerName(layer) {
        for (const [name, dataLayer] of Object.entries(dataLayers)) {
            if (dataLayer.hasLayer(layer)) {
                return name;
            }
        }
        return null;
    }

    function showFeatureInfo(e) {
        const feature = e.target.feature;
        const props = feature.properties;
        const layerName = getLayerName(e.target);

        // If it's a census sector, also populate the attribute table
        if (layerName === 'setores') {
            populateAttributeTable(props);
        }

        let content = '<div class="popup-content">';

        // Title
        if (props.NM_BAIRRO) {
            content += `<h3>${props.NM_BAIRRO}</h3>`;
        } else if (props.CD_SETOR) {
            content += `<h3>Setor Censitário</h3>`;
        } else {
            content += `<h3>Informações</h3>`;
        }

        // Define all possible properties with labels
        const allProps = {
            'CD_SETOR': 'Código do Setor',
            'NM_MUN': 'Município',
            'NM_DIST': 'Distrito',
            'NM_BAIRRO': 'Bairro',
            'AREA_KM2': 'Área (km²)',
            'v0001': 'População Total',
            'v0002': 'Domicílios Particulares',
            'v0003': 'Domicílios Ocupados',
            'v0004': 'Domicílios Vagos',
            'v0005': 'Moradores por Domicílio',
            'v0006': 'Área Média (km²)',
            'v0007': 'Densidade Demográfica'
        };

        // For census sectors, use selected attributes; for others, show all relevant data
        const propsToShow = (layerName === 'setores') ?
            Object.fromEntries(Object.entries(allProps).filter(([key]) => selectedAttributes.has(key))) :
            allProps;

        for (const [key, label] of Object.entries(propsToShow)) {
            if (props[key] !== undefined && props[key] !== null && props[key] !== '') {
                let value = props[key];

                // Format numbers
                if (key === 'AREA_KM2' || key === 'v0006') {
                    value = parseFloat(value).toFixed(4);
                } else if (key === 'v0005') {
                    value = parseFloat(value).toFixed(1);
                } else if (!isNaN(value) && value !== '') {
                    const numValue = parseFloat(value);
                    if (Number.isInteger(numValue)) {
                        value = parseInt(value).toLocaleString('pt-BR');
                    } else {
                        value = numValue.toLocaleString('pt-BR');
                    }
                }

                content += `<p><strong>${label}:</strong> ${value}</p>`;
            }
        }

        content += '</div>';

        L.popup()
            .setLatLng(e.latlng)
            .setContent(content)
            .openOn(map);
    }

    // ==================== Attribute Table Functions ====================
    function populateAttributeTable(properties) {
        const tableBody = document.getElementById('attributeTableBody');
        const tablePanel = document.getElementById('attributeTablePanel');

        // Show the table panel
        tablePanel.style.display = 'block';

        // Clear existing rows
        tableBody.innerHTML = '';

        // Define all attributes with friendly names
        const attributeLabels = {
            'CD_SETOR': 'Código do Setor',
            'CD_REGIAO': 'Código da Região',
            'NM_REGIAO': 'Nome da Região',
            'CD_UF': 'Código da UF',
            'NM_UF': 'Nome da UF',
            'CD_MUN': 'Código do Município',
            'NM_MUN': 'Nome do Município',
            'CD_DIST': 'Código do Distrito',
            'NM_DIST': 'Nome do Distrito',
            'CD_SUBDIST': 'Código do Subdistrito',
            'NM_SUBDIST': 'Nome do Subdistrito',
            'CD_BAIRRO': 'Código do Bairro',
            'NM_BAIRRO': 'Nome do Bairro',
            'CD_RGINT': 'Código da Região Intermediária',
            'NM_RGINT': 'Nome da Região Intermediária',
            'CD_RGI': 'Código da Região Imediata',
            'NM_RGI': 'Nome da Região Imediata',
            'CD_CONCURB': 'Código da Concentração Urbana',
            'NM_CONCURB': 'Nome da Concentração Urbana',
            'AREA_KM2': 'Área (km²)',
            'v0001': 'População Total',
            'v0002': 'Domicílios Particulares Permanentes',
            'v0003': 'Domicílios Particulares Ocupados',
            'v0004': 'Domicílios Particulares Vagos',
            'v0005': 'Moradores por Domicílio',
            'v0006': 'Área Média por Domicílio (km²)',
            'v0007': 'Densidade Demográfica (hab/km²)'
        };

        // Populate table with all properties
        for (const [key, value] of Object.entries(properties)) {
            if (key === 'geometry') continue; // Skip geometry

            const row = document.createElement('tr');
            const labelCell = document.createElement('td');
            const valueCell = document.createElement('td');

            // Use friendly label or key itself
            labelCell.textContent = attributeLabels[key] || key;

            // Format value
            let formattedValue = value;
            if (value === null || value === undefined || value === '') {
                formattedValue = '-';
            } else if (key === 'AREA_KM2' || key === 'v0006') {
                formattedValue = parseFloat(value).toFixed(4);
            } else if (key === 'v0005') {
                formattedValue = parseFloat(value).toFixed(1);
            } else if (!isNaN(value) && typeof value === 'number') {
                formattedValue = value.toLocaleString('pt-BR');
            }

            valueCell.textContent = formattedValue;

            row.appendChild(labelCell);
            row.appendChild(valueCell);
            tableBody.appendChild(row);
        }

        // Scroll to top of table
        document.getElementById('attributeTableContainer').scrollTop = 0;
    }

    // ==================== Event Listeners ====================
    function setupEventListeners() {
        // Basemap selection
        document.querySelectorAll('.basemap-option').forEach(option => {
            option.addEventListener('click', () => {
                const basemap = option.dataset.basemap;
                addBasemap(basemap);
            });
        });

        // Layer toggles
        document.querySelectorAll('.layer-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', async (e) => {
                const layerName = e.target.id.replace('layer-', '');

                if (e.target.checked) {
                    showLoading();
                    await loadLayer(layerName);
                    if (dataLayers[layerName]) {
                        dataLayers[layerName].addTo(map);
                    }
                    hideLoading();

                    // Show attribute selector for census sectors
                    if (layerName === 'setores') {
                        document.getElementById('attributeSelector').style.display = 'block';
                        // Show thematic mapping panel
                        document.getElementById('thematicMappingPanel').style.display = 'block';
                    }
                } else {
                    if (dataLayers[layerName]) {
                        map.removeLayer(dataLayers[layerName]);
                    }

                    // Hide attribute selector when census sectors is unchecked
                    if (layerName === 'setores') {
                        document.getElementById('attributeSelector').style.display = 'none';
                        // Hide thematic mapping panel
                        document.getElementById('thematicMappingPanel').style.display = 'none';
                        // Reset thematic mapping if active
                        resetThematicMapping();
                    }
                }
            });
        });

        // Attribute selector checkboxes
        document.querySelectorAll('#attributesList input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const attribute = e.target.value;

                if (e.target.checked) {
                    selectedAttributes.add(attribute);
                } else {
                    selectedAttributes.delete(attribute);
                }

                console.log('Atributos selecionados:', Array.from(selectedAttributes));
            });
        });

        // Map controls
        document.getElementById('zoomInBtn').addEventListener('click', () => {
            map.zoomIn();
        });

        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            map.zoomOut();
        });

        document.getElementById('homeBtn').addEventListener('click', () => {
            map.setView(CONFIG.center, CONFIG.zoom);
        });

        // Info modal
        const infoBtn = document.getElementById('infoBtn');
        const infoModal = document.getElementById('infoModal');
        const closeModal = document.getElementById('closeModal');

        infoBtn.addEventListener('click', () => {
            infoModal.classList.add('active');
        });

        closeModal.addEventListener('click', () => {
            infoModal.classList.remove('active');
        });

        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) {
                infoModal.classList.remove('active');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                infoModal.classList.remove('active');
                // Also close attribute table if open
                const tablePanel = document.getElementById('attributeTablePanel');
                if (tablePanel.style.display === 'block') {
                    tablePanel.style.display = 'none';
                }
            }
        });

        // Close attribute table button
        document.getElementById('closeTableBtn').addEventListener('click', () => {
            document.getElementById('attributeTablePanel').style.display = 'none';
        });
    }

    // ==================== Loading Indicator ====================
    function showLoading() {
        loadingIndicator = document.getElementById('loadingIndicator');
        loadingIndicator.classList.remove('hidden');
    }

    function hideLoading() {
        if (loadingIndicator) {
            loadingIndicator.classList.add('hidden');
        }
    }

    // ==================== Color Utilities ====================
    function getColorForValueGradient(value, min, max, colorScale) {
        const normalized = (value - min) / (max - min);
        const hue = (1 - normalized) * 120; // Red to green
        return `hsl(${hue}, 70%, 50%)`;
    }

    // ==================== Thematic Mapping Functions ====================
    let currentThematicAttribute = null;
    let thematicBreaks = [];
    const thematicColors = ['#E0E0E0', 'rgba(255, 255, 0, 0.5)', 'rgba(255, 165, 0, 0.6)', 'rgba(255, 0, 0, 0.7)', '#800080'];

    function classifyData(values, numClasses = 5) {
        // Remove null/undefined values and sort
        const validValues = values.filter(v => v !== null && v !== undefined && !isNaN(v)).sort((a, b) => a - b);

        if (validValues.length === 0) return [];

        const breaks = [];
        const step = Math.floor(validValues.length / numClasses);

        breaks.push(validValues[0]); // min

        for (let i = 1; i < numClasses; i++) {
            const index = Math.min(i * step, validValues.length - 1);
            breaks.push(validValues[index]);
        }

        breaks.push(validValues[validValues.length - 1]); // max

        return breaks;
    }

    function getColorForValue(value, breaks, colors) {
        if (value === null || value === undefined || isNaN(value)) {
            return '#cccccc'; // Gray for no data
        }

        for (let i = 0; i < breaks.length - 1; i++) {
            if (value >= breaks[i] && value <= breaks[i + 1]) {
                return colors[i];
            }
        }

        return colors[colors.length - 1];
    }

    function applyThematicMapping(attributeKey, attributeLabel) {
        const layer = dataLayers['setores'];
        if (!layer) {
            alert('Camada de setores censitários não está carregada.');
            return;
        }

        // Collect all values
        const values = [];
        layer.eachLayer(feature => {
            const value = feature.feature.properties[attributeKey];
            if (value !== null && value !== undefined && !isNaN(value)) {
                values.push(parseFloat(value));
            }
        });

        if (values.length === 0) {
            alert('Nenhum dado numérico encontrado para este atributo.');
            return;
        }

        // Classify data
        thematicBreaks = classifyData(values, 5);
        currentThematicAttribute = attributeKey;

        // Re-style layer
        layer.eachLayer(feature => {
            const value = feature.feature.properties[attributeKey];
            const color = getColorForValue(value, thematicBreaks, thematicColors);

            feature.setStyle({
                fillColor: color,
                weight: 1,
                opacity: 1,
                color: '#000000',
                fillOpacity: 0.5  // More transparent
            });
        });

        // Update legend
        updateLegend(attributeLabel, thematicBreaks, thematicColors);

        // Show reset button
        document.getElementById('resetThematicBtn').style.display = 'block';

        console.log(`Thematic mapping applied for: ${attributeLabel}`);
    }

    function resetThematicMapping() {
        const layer = dataLayers['setores'];
        if (!layer) return;

        const originalColor = CONFIG.layers.setores.color;

        // Reset to original style
        layer.eachLayer(feature => {
            feature.setStyle({
                fillColor: originalColor,
                weight: 2,
                opacity: 1,
                color: originalColor,
                fillOpacity: 0.3
            });
        });

        // Reset legend
        document.getElementById('legendContent').innerHTML = '<p class="legend-placeholder">Selecione uma camada para ver a legenda</p>';

        // Reset variables
        currentThematicAttribute = null;
        thematicBreaks = [];

        // Hide reset button
        document.getElementById('resetThematicBtn').style.display = 'none';

        // Reset select
        document.getElementById('thematicAttributeSelect').value = '';
        document.getElementById('applyThematicBtn').disabled = true;

        console.log('Thematic mapping reset');
    }

    function updateLegend(attributeLabel, breaks, colors) {
        const legendContent = document.getElementById('legendContent');

        let html = `<div class="legend-title">${attributeLabel}</div>`;
        html += '<div class="legend-classes">';

        for (let i = 0; i < colors.length; i++) {
            const minVal = breaks[i];
            const maxVal = breaks[i + 1];

            let label;
            if (minVal === maxVal) {
                label = minVal.toLocaleString('pt-BR');
            } else {
                label = `${minVal.toLocaleString('pt-BR')} - ${maxVal.toLocaleString('pt-BR')}`;
            }

            html += `
            <div class="legend-class-item">
                <div class="legend-color-box" style="background-color: ${colors[i]}"></div>
                <span class="legend-label">${label}</span>
            </div>
        `;
        }

        html += '</div>';
        legendContent.innerHTML = html;
    }

    // ==================== Thematic Mapping Event Listeners ====================
    document.addEventListener('DOMContentLoaded', () => {
        const thematicSelect = document.getElementById('thematicAttributeSelect');
        const applyBtn = document.getElementById('applyThematicBtn');
        const resetBtn = document.getElementById('resetThematicBtn');

        // Enable/disable apply button based on selection
        thematicSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                applyBtn.disabled = false;
            } else {
                applyBtn.disabled = true;
                resetThematicMapping();
            }
        });

        // Apply thematic mapping
        applyBtn.addEventListener('click', () => {
            const selectedValue = thematicSelect.value;
            const selectedText = thematicSelect.options[thematicSelect.selectedIndex].text;

            if (selectedValue) {
                applyThematicMapping(selectedValue, selectedText);
            }
        });

        // Reset thematic mapping
        resetBtn.addEventListener('click', () => {
            resetThematicMapping();
        });
    });

    // ==================== Initialize Application ====================
    document.addEventListener('DOMContentLoaded', () => {
        initMap();

        // Add smooth animations
        setTimeout(() => {
            document.body.style.opacity = '1';
        }, 100);
    });

    // ==================== Error Handling ====================
    window.addEventListener('error', (e) => {
        console.error('Application error:', e.error);
        hideLoading();
    });

    window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled promise rejection:', e.reason);
        hideLoading();
    });
