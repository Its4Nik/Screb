# Notifer
📬Notifer is a selfhosted YAML configurable "Notification-Relay"

# Features:

1. Easy YAML Config
2. Available for everyone (selfhosted and free)
3. OpenSource
4. "Plugin" (Custom Notification service) support
5. Runs inside docker container (alpine based)
6. Low ressource demands
7. WebAPI via. URLs 
8. Multiple Groups

# ToDo:

[] Write Backend
[ ] Create Dockerfile
[ ] Tutorials
[ ] Contribute guide
[ ] Better ReadMe

# Mountable files:

- ./notifer.yaml:/app/notifer.yaml 
Base config: local port, refresh interval (scanning for nee yaml files), ...

- ./notifer.env:/app/notifer.env
Store your secrets here

- ./custom-notifications/:/app/yamls/
Put your different notification providers here (examples soons)

