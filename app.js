const TrainDetails = ({ train, connection, onBack }) => {
    const [timetable, setTimetable] = React.useState(null);
    const [loadingTimetable, setLoadingTimetable] = React.useState(false);

    React.useEffect(() => {
        if (!train || !connection) return;

        setLoadingTimetable(true);
        setTimetable(null);

        connection.invoke('GetTimetable', train.Id)
            .then(data => {
                setTimetable(data);
                setLoadingTimetable(false);
            })
            .catch(err => {
                console.error(`Failed to get timetable for train ${train.Id}`, err);
                setLoadingTimetable(false);
            });
    }, [train, connection]);

    if (!train) return null;

    const { TrainData, DriverName } = train;

    return (
        <div>
            <button onClick={onBack} className="back-button">&larr; Wróć do listy</button>
            <h3>Pociąg nr {TrainData.Number}</h3>
            <ul className="details-list">
                <li><strong>Relacja:</strong> {TrainData.Route}</li>
                <li><strong>Prędkość:</strong> {TrainData.Velocity} km/h</li>
                <li><strong>Maszynista:</strong> {DriverName || 'Brak danych'}</li>
                <li><strong>Kategoria:</strong> {TrainData.Category}</li>
            </ul>

            <h4>Rozkład jazdy:</h4>
            {loadingTimetable && <p>Ładowanie rozkładu...</p>}
            {timetable && timetable.Stops ? (
                <ul className="timetable-list">
                    {timetable.Stops.map((stop, index) => (
                        <li key={index}>
                            <strong>{stop.StopName}</strong>
                            <br />
                            Przyjazd: {stop.ArrivalLine ? `${stop.ArrivalRealTime} (${stop.ArrivalDelay} min)` : '-'}
                            <br />
                            Odjazd: {stop.DepartureLine ? `${stop.DepartureRealTime} (${stop.DepartureDelay} min)` : '-'}
                        </li>
                    ))}
                </ul>
            ) : !loadingTimetable && <p>Brak danych o rozkładzie.</p>}
        </div>
    );
};

const App = () => {
    const [servers, setServers] = React.useState([]);
    const [trains, setTrains] = React.useState([]);
    const [selectedTrain, setSelectedTrain] = React.useState(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [connection, setConnection] = React.useState(null);
    const [status, setStatus] = React.useState('Łączenie...');
    const [map, setMap] = React.useState(null);
    const trainMarkers = React.useRef({});

    // Initialize map
    React.useEffect(() => {
        const leafletMap = L.map('map', { zoomControl: false }).setView([52.237049, 21.017532], 7);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(leafletMap);
        setMap(leafletMap);
        return () => leafletMap.remove();
    }, []);

    // Initialize SignalR
    React.useEffect(() => {
        const newConnection = new signalR.HubConnectionBuilder()
            .withUrl("https://api.smo.data-unknown.com/signalr")
            .withAutomaticReconnect()
            .build();
        setConnection(newConnection);
    }, []);

    // Handle connection
    React.useEffect(() => {
        if (!connection) return;

        const startConnection = async () => {
            try {
                await connection.start();
                setStatus('Połączono!');
                connection.on('ServersReceived', setServers);
                connection.on('TrainsReceived', (trains) => {
                    setTrains(trains);
                    // When full train list is received, also clear selection if it's no longer there
                    setSelectedTrain(current => trains.find(t => t.Id === (current && current.Id)) || null);
                });
                connection.on('TrainPositionsReceived', (trainPositions) => {
                    setTrains(currentTrains => currentTrains.map(train => {
                        const newPosition = trainPositions.find(p => p.Id === train.Id);
                        return newPosition ? { ...train, TrainData: { ...train.TrainData, Latitude: newPosition.Latitude, Longitude: newPosition.Longitude, Velocity: newPosition.Velocity } } : train;
                    }).filter(train => trainPositions.some(p => p.Id === train.Id)));
                });
                await connection.invoke('GetServers');
                // Select a default server on first load
                await connection.invoke('SwitchServer', 'PL1');
            } catch (e) {
                console.error('Connection failed: ', e);
                setStatus('Błąd połączenia. Próba ponownego połączenia...');
            }
        };

        startConnection();
        return () => { connection.stop(); };
    }, [connection]);

    // Update train markers
    React.useEffect(() => {
        if (!map) return;
        const currentMarkerIds = Object.keys(trainMarkers.current);
        const trainIds = trains.map(t => t.Id);

        currentMarkerIds.forEach(markerId => {
            if (!trainIds.includes(markerId)) {
                trainMarkers.current[markerId].remove();
                delete trainMarkers.current[markerId];
            }
        });

        trains.forEach(train => {
            const { Latitude, Longitude, Number: trainNumber } = train.TrainData;
            const trainId = train.Id;

            if (trainMarkers.current[trainId]) {
                trainMarkers.current[trainId].setLatLng([Latitude, Longitude]);
            } else {
                const newMarker = L.marker([Latitude, Longitude]).addTo(map);
                newMarker.on('click', () => {
                    setSelectedTrain(train);
                    map.setView([Latitude, Longitude], 14); // Zoom on train
                });
                trainMarkers.current[trainId] = newMarker;
            }
            // Update popup content in case train number changes
            trainMarkers.current[trainId].bindPopup(`Pociąg nr: ${trainNumber}`);
        });
    }, [trains, map]);

    const handleTrainSelect = (train) => {
        setSelectedTrain(train);
        if (map) {
            map.setView([train.TrainData.Latitude, train.TrainData.Longitude], 14);
            trainMarkers.current[train.Id].openPopup();
        }
    };

    const filteredTrains = trains.filter(train =>
        train.TrainData.Number.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <>
            <div id="sidebar">
                {selectedTrain ? (
                    <TrainDetails train={selectedTrain} connection={connection} onBack={() => setSelectedTrain(null)} />
                ) : (
                    <>
                        <div className="sidebar-header">
                            <h2>SimRail Mapa</h2>
                            <p>Status: {status}</p>
                        </div>
                        <div className="sidebar-content">
                            <h3>Aktywne pociągi</h3>
                            <input
                                type="text"
                                placeholder="Szukaj pociągu (np. 42100)"
                                className="search-input"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <ul className="train-list">
                                {filteredTrains.length > 0 ? (
                                    filteredTrains.map(train => (
                                        <li key={train.Id} onClick={() => handleTrainSelect(train)} className="train-item">
                                            <strong>Pociąg {train.TrainData.Number}</strong>
                                            <span>{train.TrainData.Route}</span>
                                        </li>
                                    ))
                                ) : (
                                    <li>Brak pociągów lub nie znaleziono...</li>
                                )}
                            </ul>
                        </div>
                    </>
                )}
            </div>
            <div id="map" />
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);