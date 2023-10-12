AWS Networking Setup:

1. Create Virtual Private Cloud (VPC).
2. Create subnets in your VPC. You must create 3 public subnets and 3 private subnets, each in a different availability zone in the same region in the same VPC.
3. Create an Internet Gateway resource and attach the Internet Gateway to the VPC.
4. Create a public route table. Attach all public subnets created to the route table.
5. Create a private route table. Attach all private subnets created to the route table.
6. Create a public route in the public route table created above with the destination CIDR block 0.0.0.0/0 and the internet gateway created above as the target.

Infrastructure as Code with Pulumi:

1. Install and set up the AWS command-line interface.
2. Write Pulumi code in a high level language (you cannot use YAML) all the networking resources.
3. Values should not be hard coded in your code.
