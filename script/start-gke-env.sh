#!/bin/bash

CLUSTER=${1:?}
ZONE=${2:?}
VERSION=${3:?}
ADMIN=${4:?}

if ! gcloud container clusters list; then
    echo "Unable to access gcloud project"
    exit 1
fi

if gcloud container clusters list | grep -q $CLUSTER; then
    echo "GKE cluster already exits. Deleting resources"
    # Cluster already exists, make sure it is clean
    gcloud container clusters delete $CLUSTER --zone $ZONE
fi

echo "Creating cluster $CLUSTER in $ZONE (v$VERSION)"
gcloud container clusters create --cluster-version=$VERSION --zone $ZONE $CLUSTER --num-nodes 5 --machine-type=n1-standard-2
# Wait for the cluster to respond
cnt=20
until kubectl get pods; do
    ((cnt=cnt-1)) || (echo "Waited 20 seconds but cluster is not reachable" && exit 1)
    sleep 1
done

# Set the current user as admin
kubectl create clusterrolebinding kubeapps-cluster-admin --clusterrole=cluster-admin --user=$ADMIN
