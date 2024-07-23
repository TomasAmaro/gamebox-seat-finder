const baseUrl = 'https://gamebox.sporting.pt/api';
const fs = require('node:fs/promises');

const scriptArguments = { 
    memberNumber: {
        type: 'number', 
        required: true,
    },  
    numberOfSeats: {
        type: 'number', 
        required: false,
        default: 1, 
    },
    sectorType: {
        type: 'string', 
        required: false,
        default: 'A',
        },
    };

const argumentsService = () => {
    const getArgumentValue = (argumentKey) => {
        const argument = scriptArguments[argumentKey];
        
        if (!argument) {
            throw new Error(`Argument ${argumentKey} is not valid`);
        }

        const keyIndex = process.argv.indexOf(`--${argumentKey}`);
        
        if (keyIndex > -1) {
            const value = process.argv[keyIndex + 1];
            if (!value) {
                throw new Error(`Argument ${argumentKey} needs a value`);
            }
            if (argument.type === 'number') {
                return parseInt(value);
            }
            return value;
        } else {
            if (argument.required) {
                throw new Error(`Argument ${argumentKey} is required`);
            }
            return argument.default;
        }  
    };

return {
    getValue: (argumentKey) => {
        return getArgumentValue(argumentKey);
    },
    getAllValues: () => {
        return Object.keys(scriptArguments).reduce((acc, argument) => {
            return {...acc, [argument]: getArgumentValue(argument)};
        }, {});
    }
}
};
const apiService = async ({endpoint, method = 'POST', body}) => {
    const requestBody = JSON.stringify(body);
    const response = await fetch(`${baseUrl}/${endpoint}`, 
        {
            method, 
            body: requestBody, 
            headers: {
                'Content-Type': 'application/json', 
                'Content-Length': Buffer.byteLength(requestBody),
            }
        });
        const responseBody = await response.json();
        if (!responseBody.success) {
            throw new Error(responseBody.message);
        }
        return responseBody;
};

const zonesService = async (sectorType) => {
    try {
    const memberNumber = argumentsService().getValue('memberNumber');
    const response = await apiService({
        endpoint: 'stadium/zones',
        body: {
            guid: "c6465a0f-ff22-4c9a-9f4c-eede07e630bf",
            memberNumber,
            venueId: 1
            },
        });
    const zones = response.data.zones;
    return zones.filter(zone => {
        if (sectorType) {
            return zone.isAvailable && zone.name.startsWith(sectorType);
        }
        return zone.isAvailable
    });
    } catch (error) {
    console.error(error);
    throw error;
    }
};

const seatService = async (sector) => {
    try {
    const memberNumber = argumentsService().getValue('memberNumber');
    const response = await apiService({
        endpoint: 'seat', 
        body: {
            zones: [],
            sector: typeof sector === 'number' ? sector.toString() : sector,
            guid: "c6465a0f-ff22-4c9a-9f4c-eede07e630bf",
            memberNumber,
            venueId: 3,
            },
        });
    return response.data;
    } catch (error) {
    console.error(error);    
    }
};

const parseSeatsMap = (seatMap) => {
    const parsedRowsMap = seatMap.map((row) =>  {
    if(typeof row === 'string') {
     return row
     .replace(/(?<![0-9])_+/g, '')
     .replace(/, /g, '')
     .split(']')
     .filter(row => row.length > 0);   
    } 
    return [];
    });
    
    const parsedSeatsMap = parsedRowsMap.map((row) => {
        return row.reduce((acc, seat) => {
            const [id, rowNumber, seatNumber] = seat.split('_');
            const [seatStatus, seatId] = id.split('[');
            const isAvailable = seatStatus === 'd';

            const currentRow = acc.row === parseInt(rowNumber) ? acc : {row: parseInt(rowNumber), seats: []};
            const seats = [{isAvailable, seatNumber: parseInt(seatNumber), seatId}, ...currentRow.seats]
            return {...currentRow, seats};
        }, {})
    });
    return parsedSeatsMap;
};

const filterAvailableSeats = (row) => {
    return row.seats.filter(seat => seat.isAvailable);;
}

const getAvailableSeats = async (options) => {
    const { numberOfSeats, sectorType} = options;
    const zones = await zonesService(sectorType);
    const availableZones = (await Promise.all(zones.map(async zone => {
            const seats = await seatService(zone.id);
            const parsedSeatMap = parseSeatsMap(seats.map);
            const availableSeats = parsedSeatMap.flatMap(row => {
                const availableSeats = filterAvailableSeats(row);
                if (availableSeats) {
                 return availableSeats.map(seat => ({row: row.row, ...seat}));
                }
            });

            if (numberOfSeats) {
                if (availableSeats.length >= numberOfSeats) {
                    return {
                        [zone.name]: availableSeats
                    };
                } else {
                    return undefined;
                }
            }
            return {
                [zone.name]: availableSeats
            };
    }))).filter(zone => zone);
    return availableZones;
};

( async () => {
    try {
        const arguments = argumentsService().getAllValues();
        console.log(arguments);

        const seatsAvailable = await getAvailableSeats(arguments);
        const templateHtml = await fs.readFile('template.html', 'utf-8');
        const jsonData = JSON.stringify(seatsAvailable, null, 2);
        const dir = await fs.mkdir('output', {recursive: true});
        await fs.writeFile(`${dir}/output.json`, jsonData);
        await fs.writeFile(`${dir}/index.html`, templateHtml.replace('//$tableData', `tableData = ${jsonData}`));   
    } catch (error) {
        console.error(error);
    }
})()