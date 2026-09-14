#!/bin/bash
# This is a script used by the devcontainer to build the project

# install dependencies
yarn install

# Build Server Dependencies
yarn notesgraph @notesgraph/server-native build

# Create database
yarn notesgraph @notesgraph/server prisma migrate reset -f
