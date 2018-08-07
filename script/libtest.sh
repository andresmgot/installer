# Copyright (c) 2018 Bitnami
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

export TEST_MAX_WAIT_SEC=300

## k8s specific Helper functions
k8s_wait_for_pod_ready() {
    echo "Waiting for pod '${@}' to be ready ... "
    local -i cnt=${TEST_MAX_WAIT_SEC:?}

    # Retries just in case it is not stable
    local -i successCount=0
    while [ "$successCount" -lt "3" ]; do
        if kubectl get pod "${@}" | grep -q Running; then
            ((successCount=successCount+1))
        fi
        ((cnt=cnt-1)) || return 1
        sleep 1
    done
}

k8s_wait_for_pod_completed() {
    echo "Waiting for pod '${@}' to be completed ... "
    local -i cnt=${TEST_MAX_WAIT_SEC:?}

    # Retries just in case it is not stable
    local -i successCount=0
    while [ "$successCount" -lt "3" ]; do
        if kubectl get pod -a "${@}" | grep -q Completed; then
            ((successCount=successCount+1))
        fi
        ((cnt=cnt-1)) || return 1
        sleep 1
    done
}
