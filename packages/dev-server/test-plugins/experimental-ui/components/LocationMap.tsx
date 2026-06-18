import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { Card } from '@vendure/admin-ui/react';
import React, { useEffect } from 'react';

const containerStyle = {
    width: '100%',
    height: '400px',
};

const center = {
    lat: 48.212616,
    lng: 16.3230408,
};

export function LocationMap() {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: 'AIzaSyCKxhBHUymQG7L57NeRhJRdzlvO4kcymXU',
    });

    const [map, setMap] = React.useState(null);

    const onLoad = React.useCallback(function callback(map) {
        // This is just an example of getting and using the map instance!!! don't just blindly copy!

        const bounds = new window.google.maps.LatLngBounds(center);
        map.fitBounds(bounds);
        setMap(map);
        new window.google.maps.Marker({
            position: center,
            map,
            title: 'Hello World!',
        });
    }, []);

    useEffect(() => {
        setTimeout(() => {
            (map as any)?.setZoom(9);
        }, 1000);
    }, [map]);

    const onUnmount = React.useCallback(function callback(map) {
        setMap(null);
    }, []);

    return isLoaded ? (
        <div className="mb-4">
            <Card title="Location">
                <GoogleMap
                    mapContainerStyle={containerStyle}
                    center={center}
                    onLoad={onLoad}
                    onUnmount={onUnmount}
                    options={{
                        zoom: 20,
                        minZoom: 10,
                        fullscreenControl: false,
                        streetViewControl: false,
                        zoomControl: false,
                        mapTypeControl: false,
                    }}
                >
                    {/* Child components, such as markers, info windows, etc. */}
                    <></>
                </GoogleMap>
            </Card>
        </div>
    ) : (
        <></>
    );
}
