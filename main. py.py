from pylandroidcloud.api import LandroidAPI, LandroidMowerList

# Zugangsdaten (aus der App)
client_id = "your-client-id"
client_secret = "your-client-secret"
username = "your-email"
password = "your-password"

# Authentifizieren
api = LandroidAPI(
    client_id=client_id,
    client_secret=client_secret,
    username=username,
    password=password
)

# Alle Mäher laden
mower_list = LandroidMowerList(api)

for mower in mower_list.mowers:
    print(f"Name: {mower.name}, Serial: {mower.serial_number}")
