UniVast

UniVast is a university campus navigation and information platform designed to help students discover universities, explore campus locations, find destinations, and navigate between locations using shortest walking routes.

The project consists of a Node.js/Express backend API and a .NET MAUI mobile application with interactive map-based navigation.

---

Table of Contents

- "Overview" (#overview)
- "Features" (#features)
- "Architecture" (#architecture)
- "Technology Stack" (#technology-stack)
- "Project Structure" (#project-structure)
- "Prerequisites" (#prerequisites)
- "Backend Setup" (#backend-setup)
- "Mobile App Setup" (#mobile-app-setup)
- "API Configuration" (#api-configuration)
- "Navigation System" (#navigation-system)
- "Location Permissions" (#location-permissions)
- "API Endpoints" (#api-endpoints)
- "Development" (#development)
- "Testing" (#testing)
- "Security" (#security)
- "Roadmap" (#roadmap)
- "Contributing" (#contributing)
- "License" (#license)

---

Overview

UniVast is built around two main applications:

Backend

The backend provides the REST API responsible for:

- University and campus data
- Navigation nodes
- Navigation edges
- Route calculation
- Location-based navigation
- Database operations
- API validation and error handling

Mobile Application

The mobile application provides the user-facing experience:

- Campus exploration
- Start and destination selection
- GPS-based location detection
- Shortest walking route calculation
- Interactive map visualization

---

Features

Campus Navigation

- Select a starting location
- Select a destination
- Use the device's current location as the starting point
- Automatically find the nearest navigation node
- Calculate the shortest walking route
- Display the calculated route on an interactive map
- Automatically fit the map to the route
- Display navigation nodes and locations

Backend

- RESTful API
- MongoDB database integration
- Mongoose ODM
- University management
- Campus management
- Navigation node management
- Navigation edge management
- Shortest-path routing
- Dijkstra's algorithm
- Haversine distance calculations
- Nearest-node detection
- Request validation
- ObjectId validation
- Centralized error handling
- Async request handling

Mobile Application

- .NET MAUI
- C#
- Mapsui
- GPS/location support
- Shell navigation
- API service layer
- Start/destination pickers
- Route visualization
- Cross-platform application architecture

---

Architecture

                    ┌─────────────────────────┐
                    │      UniVast Mobile     │
                    │      .NET MAUI + C#     │
                    │                         │
                    │       Mapsui            │
                    └────────────┬────────────┘
                                 │
                                 │ HTTPS / REST API
                                 ▼
                    ┌─────────────────────────┐
                    │       UniVast API       │
                    │                         │
                    │ Node.js + Express       │
                    │ Mongoose                │
                    │ Routing Service         │
                    └────────────┬────────────┘
                                 │
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │        MongoDB          │
                    │                         │
                    │ Universities            │
                    │ Campuses                │
                    │ Navigation Nodes        │
                    │ Navigation Edges        │
                    └─────────────────────────┘

---

Technology Stack

Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- JavaScript
- REST API

Mobile

- C#
- .NET
- .NET MAUI
- Mapsui
- XAML

Algorithms

- Dijkstra's shortest-path algorithm
- Haversine distance formula
- Graph-based campus routing

---

Project Structure

UNIVAST_project/
│
├── backend/
│   │
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   │
│   ├── .env.example
│   ├── package.json
│   └── server.js
│
├── UNIVAST.Mobile/
│   │
│   ├── Models/
│   ├── Pages/
│   ├── Services/
│   ├── Resources/
│   ├── Platforms/
│   │   ├── Android/
│   │   ├── iOS/
│   │   └── MacCatalyst/
│   │
│   ├── App.xaml
│   ├── App.xaml.cs
│   ├── AppShell.xaml
│   ├── AppShell.xaml.cs
│   ├── MainPage.xaml
│   ├── MainPage.xaml.cs
│   ├── MauiProgram.cs
│   └── UNIVAST.Mobile.csproj
│
├── .gitignore
└── README.md

---

Prerequisites

Before running UniVast, install the required development tools.

Backend Requirements

Install:

- Node.js LTS
- npm
- MongoDB or MongoDB Atlas

npm is included with Node.js.

Verify your installation:

node --version
npm --version

Example:

v22.x.x
10.x.x

The exact versions may differ.

---

Backend Setup

1. Clone the Repository

git clone https://github.com/rexxwurld/univast.git

Enter the project:

cd univast

Enter the backend:

cd backend

---

2. Install Dependencies

Run:

npm install

This automatically installs the dependencies declared in:

backend/package.json

You do not need to manually install each Node.js package.

---

3. Configure Environment Variables

Create your environment file from the example:

cp .env.example .env

Open ".env" and configure your database connection.

Example:

MONGODB_URI=your_mongodb_connection_string
PORT=5000

Do not commit ".env" to GitHub.

The repository's ".gitignore" already excludes environment files.

---

4. Start the Backend

For development:

npm run dev

For production:

npm start

The API will run on the configured port.

For example:

http://localhost:5000

---

MongoDB

UniVast uses MongoDB for persistent application data.

You can use either:

Local MongoDB

Install MongoDB on your development machine and run the MongoDB service locally.

Example connection:

MONGODB_URI=mongodb://127.0.0.1:27017/univast

MongoDB Atlas

Alternatively, create a MongoDB Atlas cluster and use its connection string:

MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/univast

Never commit database credentials to GitHub.

---

Mobile App Setup

The mobile application is built with .NET MAUI.

Requirements

Install:

- .NET SDK
- .NET MAUI workload
- Android SDK for Android development
- Android emulator or physical Android device

For development on Windows, Visual Studio with .NET MAUI support can be used.

VS Code can also be used with the appropriate .NET tooling.

---

Installing .NET

Verify that the .NET SDK is installed:

dotnet --version

You should receive a version number.

If "dotnet" is not recognized, install the .NET SDK before continuing.

---

Installing .NET MAUI

On a supported development computer, install the MAUI workload:

dotnet workload install maui

Verify the installed workloads:

dotnet workload list

You should see the MAUI workload listed.

---

Android Development

For Android development, install the Android SDK and required Android tooling.

You can use:

- Android Studio
- Visual Studio Android tooling
- Android SDK command-line tools

You also need either:

- An Android emulator
- A physical Android device

For a physical Android device, enable Developer Options and USB debugging.

---

Mobile Dependencies

Navigate to the mobile project:

cd UNIVAST.Mobile

Restore NuGet dependencies:

dotnet restore

The required .NET packages are defined in:

UNIVAST.Mobile/UNIVAST.Mobile.csproj

This includes the project's Mapsui dependency.

You do not need to manually install the NuGet packages individually.

---

Build the Mobile Application

From the mobile project directory:

dotnet build

If the build succeeds, the project is ready to run on a supported target.

---

Running the Mobile Application

The exact command depends on the target platform and development environment.

You can run the application using:

- Visual Studio
- VS Code with the appropriate .NET tooling
- "dotnet" CLI
- Android emulator
- Physical Android device

For Android development, make sure the Android SDK and target device are configured correctly.

---

API Configuration

The mobile application communicates with the UniVast backend through:

UNIVAST.Mobile/Services/ApiConfig.cs

This file contains the API configuration.

The application needs to know where the backend is running.

---

Android Emulator

When the backend is running on the development computer, Android emulators commonly use:

10.0.2.2

instead of:

localhost

For example:

http://10.0.2.2:5000

---

Physical Android Device

When running the mobile application on a physical device, "localhost" refers to the phone itself.

Use the development computer's local network IP address instead.

Example:

http://192.168.1.100:5000

Both the computer and phone must be connected to the same network.

---

Production

When the backend is deployed, configure the mobile application to use the deployed HTTPS API:

https://api.example.com

Do not use an unsecured HTTP endpoint for production.

---

Campus Configuration

UniVast requires campus data before navigation can function correctly.

A campus should contain:

- Campus information
- Navigation nodes
- Navigation edges
- Geographic coordinates

The mobile application uses the configured campus ID from:

UNIVAST.Mobile/Services/ApiConfig.cs

Configure the appropriate campus ID after creating the campus through the backend.

---

Navigation System

UniVast models campus navigation as a graph.

Each navigation node represents a location.

Connections between nodes represent walkable paths.

Example:

              Node B
             /      \
            /        \
        Node A ---- Node C
                       \
                        \
                       Node D

The routing service calculates a path through this graph.

---

Shortest Path

UniVast currently uses Dijkstra's algorithm to calculate the shortest route between navigation nodes.

The general flow is:

User Location
      │
      ▼
Nearest Navigation Node
      │
      ▼
Destination Node
      │
      ▼
Dijkstra Routing
      │
      ▼
Shortest Path
      │
      ▼
Mobile Map

---

Distance Calculation

Geographic distances are calculated using the Haversine formula.

The formula calculates the approximate distance between two points using their latitude and longitude coordinates.

This allows UniVast to:

- Determine distances between navigation nodes
- Find the nearest navigation node
- Assign geographical weights to navigation edges

---

GPS Navigation Flow

When the user selects My Location:

1. The application requests the device's location.
2. GPS coordinates are obtained.
3. The coordinates are sent to the backend.
4. The backend finds the nearest navigation node.
5. The nearest node becomes the starting point.
6. The user selects a destination.
7. The backend calculates the shortest route.
8. The route is returned to the mobile application.
9. Mapsui renders the route on the map.

---

Location Permissions

The application requires location permissions for GPS-based navigation.

Platform-specific permission configuration is located under:

UNIVAST.Mobile/Platforms/

Before production deployment:

- Verify Android location permissions.
- Verify iOS location permissions if supported.
- Explain to users why location access is required.
- Handle denied permissions gracefully.
- Do not collect or store location data unnecessarily.

---

API Endpoints

The backend exposes REST API endpoints for university, campus, and navigation functionality.

Navigation includes endpoints such as:

Find Nearest Node

POST /api/routes/nearest-node

This endpoint receives a geographic location and determines the closest navigation node.

Calculate Route

POST /api/routes/route

This endpoint calculates a route between navigation nodes.

Additional endpoints are organized inside the backend's route modules:

backend/routes/

The corresponding business logic is handled by the backend services and controllers.

---

Backend Architecture

The backend separates responsibilities into different layers.

Request
   │
   ▼
Routes
   │
   ▼
Controllers
   │
   ▼
Services
   │
   ├── Business Logic
   │
   └── Routing
   │
   ▼
Models
   │
   ▼
MongoDB

Routes

Define API endpoints.

Controllers

Handle HTTP requests and responses.

Services

Contain application and business logic.

Models

Define MongoDB/Mongoose data structures.

Middleware

Handles reusable request processing such as validation and error handling.

Utils

Contains reusable utility functions such as:

- Distance calculations
- Graph operations
- ObjectId validation
- API errors
- Async handlers

---

Development

Backend Development

Start the backend in development mode:

cd backend
npm run dev

Make changes to the source code and test the affected endpoints.

---

Mobile Development

Open:

UNIVAST.Mobile/

in your preferred .NET development environment.

Restore dependencies:

dotnet restore

Build:

dotnet build

Then deploy to an emulator or physical device.

---

Testing

Important backend functionality should be tested before deployment.

Testing should cover:

- API validation
- ObjectId validation
- Database operations
- Haversine calculations
- Graph construction
- Dijkstra routing
- Nearest-node detection
- Route generation
- Error handling

Mobile testing should cover:

- Application startup
- API connectivity
- Location permissions
- GPS location
- Campus loading
- Start location selection
- Destination selection
- Route calculation
- Map rendering
- Network failures
- Invalid API responses
- Physical-device behavior

---

Security

Before deploying UniVast to production:

- Never commit ".env" files.
- Never commit database credentials.
- Never expose API secrets in the mobile application.
- Use HTTPS in production.
- Validate all incoming API data.
- Validate MongoDB ObjectIds.
- Implement authentication for protected endpoints.
- Implement authorization for administrative operations.
- Add rate limiting to public endpoints.
- Keep dependencies updated.
- Handle errors without exposing sensitive internal information.
- Review location-data collection and privacy requirements.

---

Environment Files

The repository contains:

backend/.env.example

This file documents the required environment variables without containing real credentials.

Create your local environment file with:

cp .env.example .env

Never replace ".env.example" with real credentials.

---

Git Workflow

After making changes:

git status

Add changes:

git add .

Commit:

git commit -m "Describe your changes"

Push:

git push

For new features, create a separate branch:

git checkout -b feature/your-feature

Then push:

git push -u origin feature/your-feature

---

Roadmap

Potential future improvements include:

- User authentication
- Student accounts
- University profiles
- Campus search
- Building search
- Points of interest
- Turn-by-turn navigation
- Voice navigation
- Offline maps
- Accessible route support
- Multiple transportation modes
- University announcements
- Events
- Timetables
- Administrative dashboards
- Campus management tools
- Analytics
- Navigation history
- Improved route optimization

---

Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.

git checkout -b feature/your-feature

3. Make your changes.
4. Test your changes.
5. Commit your changes.

git commit -m "Add your feature"

6. Push your branch.

git push origin feature/your-feature

7. Open a Pull Request.

---

License

UniVast is currently maintained as a private development project.

Licensing terms can be added when the project is prepared for public distribution.

---

Repository

UniVast

GitHub:

https://github.com/rexxwurld/univast

---

Built With

Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- JavaScript

Mobile

- C#
- .NET
- .NET MAUI
- Mapsui
- XAML

Navigation

- Dijkstra's algorithm
- Haversine distance
- Graph-based routing

---

UniVast — Making university campuses easier to explore and navigate.
